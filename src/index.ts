import { randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { nanoid } from "nanoid";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { version } from "../package.json" with { type: "json" };
import { createMcpServer, mcpCorsHeaders, withCors } from "./mcp";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createOAuthRuntime, InMemoryEventStore } from "./oauth";
import { startRpcServer, routeRegistry } from "./rpc";

const portEnv = process.env["PORT"];
const port = portEnv !== undefined && portEnv !== "" ? Number(portEnv) : 3000;
const listenPort = Number.isFinite(port) ? port : 3000;

const USE_MCP_TOKEN_AUTH =
  process.env["USE_MCP_TOKEN_AUTH"] === "1" || process.env["USE_MCP_TOKEN_AUTH"] === "true";

const MCP_TOKEN_FILE = ".mcp-token";

function loadOrCreateMcpToken(): string {
  const env = process.env["MCP_TOKEN"]?.trim();
  if (env !== undefined && env !== "") return env;

  if (existsSync(MCP_TOKEN_FILE)) {
    const fromFile = readFileSync(MCP_TOKEN_FILE, "utf8").trim();
    if (fromFile !== "") return fromFile;
  }

  const generated = nanoid(32);
  writeFileSync(MCP_TOKEN_FILE, `${generated}\n`, { mode: 0o600 });
  console.log(`MCP_TOKEN not set; wrote new token to ${MCP_TOKEN_FILE}.`);
  return generated;
}

const mcpToken = USE_MCP_TOKEN_AUTH ? loadOrCreateMcpToken() : "";

function bearerMatchesStatic(req: Request, expected: string): boolean {
  const raw = req.headers.get("authorization");
  const lower = raw?.toLowerCase();
  const presented =
    lower !== undefined && lower.startsWith("bearer ") && raw !== null ? raw.slice(7).trim() : null;
  if (presented === null || presented === "") return false;
  try {
    const a = Buffer.from(presented, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function parseIssuerUrl(): URL {
  const raw = process.env["PUBLIC_BASE_URL"]?.trim();
  if (raw !== undefined && raw !== "") {
    const u = new URL(raw);
    if (u.hash !== "") {
      throw new Error("PUBLIC_BASE_URL must not include a fragment");
    }
    if (u.search !== "") {
      throw new Error("PUBLIC_BASE_URL must not include a query string");
    }
    return new URL(u.origin);
  }
  const railwayDomain = process.env["RAILWAY_PUBLIC_DOMAIN"]?.trim();
  if (railwayDomain !== undefined && railwayDomain !== "") {
    return new URL(`https://${railwayDomain}`);
  }
  return new URL(`http://127.0.0.1:${String(listenPort)}`);
}

const issuerUrl = parseIssuerUrl();
const mcpServerUrl = new URL("/mcp", issuerUrl);
function loadOrCreateAuthPassphrase(): string {
  const env = process.env["AUTH_PASSPHRASE"]?.trim();
  if (env !== undefined && env !== "") return env;
  return nanoid(12);
}

const authPassphrase = USE_MCP_TOKEN_AUTH ? undefined : loadOrCreateAuthPassphrase();

const allowedRedirectUriDomains = process.env["ALLOWED_REDIRECT_URI_DOMAINS"]
  ? process.env["ALLOWED_REDIRECT_URI_DOMAINS"].split(",").map((s) => s.trim()).filter(Boolean)
  : ["claude.ai"];

const oauth = createOAuthRuntime({
  issuerUrl,
  mcpServerUrl,
  resourceName: "filesystem-mcp",
  allowedRedirectUriDomains,
  ...(authPassphrase !== undefined ? { authPassphrase } : {}),
});

interface SessionEntry {
  transport: WebStandardStreamableHTTPServerTransport;
  server: McpServer;
}

const oauthSessions = new Map<string, SessionEntry>();
const tokenSessions = new Map<string, SessionEntry>();

function bodyHasInitialize(body: unknown): boolean {
  if (body === undefined || body === null) {
    return false;
  }
  if (Array.isArray(body)) {
    return body.some((m) => isInitializeRequest(m));
  }
  return isInitializeRequest(body);
}

async function handleMcpSession(
  req: Request,
  sessions: Map<string, SessionEntry>,
  authInfo?: AuthInfo,
): Promise<Response> {
  const sessionId = req.headers.get("mcp-session-id");
  const rawBody = req.method === "POST" ? await req.text() : "";
  let parsedBody: unknown;
  if (rawBody === "") {
    parsedBody = undefined;
  } else {
    try {
      parsedBody = JSON.parse(rawBody) as unknown;
    } catch {
      parsedBody = undefined;
    }
  }

  const replay = (body: string): Request => {
    const init: RequestInit = { method: req.method, headers: req.headers };
    if (body !== "") {
      init.body = body;
    }
    return new Request(req.url, init);
  };

  const extra = authInfo !== undefined ? { parsedBody, authInfo } : { parsedBody };

  if (sessionId !== null && sessionId !== "") {
    const entry = sessions.get(sessionId);
    if (entry !== undefined) {
      return withCors(await entry.transport.handleRequest(replay(rawBody), extra));
    }
  }

  if (
    (sessionId === null || sessionId === "") &&
    req.method === "POST" &&
    parsedBody !== undefined &&
    bodyHasInitialize(parsedBody)
  ) {
    const server = createMcpServer();
    const eventStore = authInfo !== undefined ? new InMemoryEventStore() : undefined;
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      ...(eventStore !== undefined ? { eventStore } : {}),
      onsessioninitialized: (sid) => {
        sessions.set(sid, { transport, server });
      },
      onsessionclosed: (sid) => {
        sessions.delete(sid);
      },
    });
    await server.connect(transport);
    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid !== undefined) {
        sessions.delete(sid);
      }
    };
    return withCors(await transport.handleRequest(replay(rawBody), extra));
  }

  return withCors(
    new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: No valid session ID provided",
        },
        id: null,
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    ),
  );
}

async function handleMcpWithOAuth(req: Request): Promise<Response> {
  const auth = await oauth.verifyMcpBearer(req);
  if ("response" in auth) return withCors(auth.response);
  return handleMcpSession(req, oauthSessions, auth.authInfo);
}

async function handleMcpWithStaticToken(req: Request): Promise<Response> {
  if (!bearerMatchesStatic(req, mcpToken)) {
    return withCors(
      new Response("Unauthorized", {
        status: 401,
        headers: { "WWW-Authenticate": 'Bearer realm="mcp"' },
      }),
    );
  }
  return handleMcpSession(req, tokenSessions);
}

startRpcServer();

Bun.serve({
  port: listenPort,
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/version") {
      return new Response(JSON.stringify({ version }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const oauthRes = await oauth.handleOAuthRequest(req);
    if (oauthRes !== null) {
      return oauthRes;
    }

    if (url.pathname === "/mcp") {
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: mcpCorsHeaders });
      }
      if (USE_MCP_TOKEN_AUTH) {
        return handleMcpWithStaticToken(req);
      }
      return handleMcpWithOAuth(req);
    }

    // Proxy to locally registered routes (registered via Unix socket RPC)
    for (const [pattern, target] of routeRegistry) {
      if (url.pathname === pattern || url.pathname.startsWith(pattern + "/")) {
        const proxyUrl = target + url.pathname + url.search;
        try {
          return await fetch(new Request(proxyUrl, {
            method: req.method,
            headers: req.headers,
            body: req.method !== "GET" && req.method !== "HEAD" ? req.body : null,
          }));
        } catch {
          return new Response("Bad gateway", { status: 502 });
        }
      }
    }

    return new Response("Not found", { status: 404 });
  },
});

if (!process.env["RAILWAY_PUBLIC_DOMAIN"]?.trim() && !process.env["PUBLIC_BASE_URL"]?.trim()) {
  console.error(`
⚠️ Public domain (RAILWAY_PUBLIC_DOMAIN or PUBLIC_BASE_URL) is required and not set. 

If you’re using Railway:
1. If you’ve manually set PUBLIC_BASE_URL make sure it’s actually set. You won’t see this message if it is.
2. Make sure you have a Public Networking domain set up: https://docs.railway.com/networking/public-networking
3. If this is your first deploy please deploy again. RAILWAY_PUBLIC_DOMAIN not being set the first time is a common Railway issue. Run \`railway down && railway up\` to redeploy.
`);
  process.exit(1);
}

console.log(`http://0.0.0.0:${String(listenPort)} → https://${issuerUrl.host}`);

if (USE_MCP_TOKEN_AUTH) {
  console.log("");
  console.log("USE_MCP_TOKEN_AUTH: static bearer (no OAuth).");
  console.log("Authorization: Bearer …");
  console.log(mcpToken);
} else {
  console.log(
    `
Claude.ai setup:
1. Settings → Connectors → Add custom connector.
2. MCP URL: ${mcpServerUrl.href}. 
3. Click "Connect". Passphrase: "${/* eslint-disable @typescript-eslint/no-non-null-assertion */ authPassphrase!}".
4. Claude will automatically authenticate and refresh tokens.`,
  );
}
