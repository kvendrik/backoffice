#!/usr/bin/env bun
/**
 * webhook — Backoffice webhook receiver
 *
 * Usage:
 *   bun /app/skills/webhook server                     Start the HTTP server (background: true)
 *   bun /app/skills/webhook register --secret <s> --cmd <c> [flags]   Register endpoint, print URL
 *   bun /app/skills/webhook list                       List active endpoints
 *   bun /app/skills/webhook rm <id>                    Unregister endpoint
 *   bun /app/skills/webhook -h                         Show this help
 */

import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { createConnection } from "node:net";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { SOCKET_PATH } from "../../src/rpc.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const WEBHOOK_PORT   = parseInt(process.env["WEBHOOK_PORT"] ?? "3002");
const STORE_DIR      = "/data/webhooks";
const REG_PATH       = `${STORE_DIR}/registrations.json`;
const SEEN_PATH      = "/tmp/webhooks/seen.json";
const MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_REPLAY_TTL = 86_400;  // 24 hours in seconds

const SECURE_HEADERS = {
  "Cache-Control":          "no-store",
  "Referrer-Policy":        "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface Registration {
  id: string;
  name?: string;
  secret: string;
  cmd: string;
  pattern: string;
  createdAt: number;
  signatureHeader: string;
  signaturePrefix: string;
  signatureEncoding: "hex" | "base64";
  replayTtl: number;
}

type RegStore  = Record<string, Registration>;
type SeenStore = Record<string, number>;  // signature → receivedAt ms

// ── Store helpers ─────────────────────────────────────────────────────────────

function ensureStoreDir(): void {
  if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true, mode: 0o700 });
}

function readJson<T>(path: string, fallback: T): T {
  try { return JSON.parse(readFileSync(path, "utf8")) as T; }
  catch { return fallback; }
}

function writeJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2), { mode: 0o600 });
}

function readRegistrations(): RegStore  { return readJson<RegStore>(REG_PATH, {}); }
function readSeen():          SeenStore { return readJson<SeenStore>(SEEN_PATH, {}); }

function writeRegistrations(s: RegStore):  void { ensureStoreDir(); writeJson(REG_PATH, s); }
function writeSeen(s: SeenStore): void { mkdirSync("/tmp/webhooks", { recursive: true }); writeJson(SEEN_PATH, s); }

function pruneSeen(store: SeenStore, ttlSeconds: number): SeenStore {
  const cutoff = Date.now() - ttlSeconds * 1000;
  return Object.fromEntries(Object.entries(store).filter(([, ts]) => ts > cutoff));
}

// ── RPC helper ────────────────────────────────────────────────────────────────

async function rpcCall(method: string, params: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(SOCKET_PATH);
    socket.on("connect", () => {
      socket.write(JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }) + "\n");
    });
    socket.on("data", () => { socket.destroy(); resolve(); });
    socket.on("error", reject);
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function baseUrl(): string {
  const domain = process.env["RAILWAY_PUBLIC_DOMAIN"]?.trim();
  if (domain) return `https://${domain}`;
  return `http://localhost:${String(WEBHOOK_PORT)}`;
}

function verifyHmac(
  body: Buffer,
  secret: string,
  presented: string | null,
  prefix: string,
  encoding: "hex" | "base64",
): boolean {
  if (!presented) return false;
  const stripped = prefix
    ? (presented.startsWith(prefix) ? presented.slice(prefix.length) : null)
    : presented;
  if (stripped === null) return false;
  const expected = createHmac("sha256", secret).update(body).digest(encoding);
  try {
    const a = Buffer.from(stripped, encoding);
    const b = Buffer.from(expected, encoding);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch { return false; }
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg?.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) { result[key] = next; i++; }
      else result[key] = true;
    }
  }
  return result;
}

// ── Help ──────────────────────────────────────────────────────────────────────

function printHelp(): void {
  console.log(`
webhook — Backoffice webhook receiver

USAGE
  bun /app/skills/webhook server                    Start HTTP server on port ${String(WEBHOOK_PORT)}
  bun /app/skills/webhook register [flags]          Register a new endpoint, print the URL
  bun /app/skills/webhook list                      Show registered endpoints
  bun /app/skills/webhook rm <id>                   Unregister endpoint

REGISTER FLAGS (--secret and --cmd are required)
  --secret <str>               HMAC-SHA256 secret (must match sender config)
  --cmd <str>                  Shell command fired on each valid request (payload on stdin as JSON)
  --name <str>                 Optional human label
  --signature-header <name>    Header containing the signature (default: X-Hub-Signature-256)
  --signature-prefix <str>     Prefix to strip before comparing (default: sha256=)
  --signature-encoding <enc>   hex | base64 (default: hex)
  --replay-ttl <seconds>       Replay detection window (default: ${String(DEFAULT_REPLAY_TTL)})

HANDLER STDIN
  { "method": "POST", "headers": { ... }, "body": "<raw body>" }

EXAMPLES
  bun /app/skills/webhook register \\
    --secret mysecret --cmd "bun /data/handle-github.ts" --name "github-push"

  # Shopify (base64)
  bun /app/skills/webhook register \\
    --secret mysecret --cmd "bun /data/handle-shopify.ts" \\
    --signature-header X-Shopify-Hmac-Sha256 --signature-prefix "" --signature-encoding base64
`.trim());
}

// ── Subcommand: server ────────────────────────────────────────────────────────

async function cmdServer(): Promise<void> {
  ensureStoreDir();
  console.log(`[webhook server] Starting on port ${String(WEBHOOK_PORT)}`);

  Bun.serve({ port: WEBHOOK_PORT, fetch: handleRequest });

  // Re-register all persisted endpoints
  const store = readRegistrations();
  for (const reg of Object.values(store)) {
    try {
      await rpcCall("route.register", { pattern: reg.pattern, target: `http://localhost:${String(WEBHOOK_PORT)}` });
      console.log(`[webhook server] Re-registered: ${reg.pattern}`);
    } catch {
      console.warn(`[webhook server] Could not re-register ${reg.pattern}`);
    }
  }

  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.on(sig, async () => {
      for (const reg of Object.values(readRegistrations())) {
        try { await rpcCall("route.unregister", { pattern: reg.pattern }); } catch { /* best effort */ }
      }
      process.exit(0);
    });
  }

  console.log(`[webhook server] Ready — ${baseUrl()}`);
}

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);

  if (url.pathname === "/health") return new Response("ok", { status: 200 });

  const match = url.pathname.match(/^\/webhook\/([a-f0-9]{64})$/);
  if (!match) return new Response("Not found", { status: 404, headers: SECURE_HEADERS });

  const id  = match[1]!;
  const reg = readRegistrations()[id];
  if (!reg) return new Response("Not found", { status: 404, headers: SECURE_HEADERS });

  // Read body (enforce size limit)
  let bodyBuf: Buffer;
  try {
    const raw = await req.arrayBuffer();
    if (raw.byteLength > MAX_BODY_BYTES)
      return new Response("Payload too large", { status: 413, headers: SECURE_HEADERS });
    bodyBuf = Buffer.from(raw);
  } catch {
    return new Response("Bad request", { status: 400, headers: SECURE_HEADERS });
  }

  // HMAC verification
  const sig = req.headers.get(reg.signatureHeader);
  if (!verifyHmac(bodyBuf, reg.secret, sig, reg.signaturePrefix, reg.signatureEncoding)) {
    console.warn(`[webhook] HMAC failed — endpoint ${id.slice(0, 8)}`);
    return new Response("Unauthorized", { status: 401, headers: SECURE_HEADERS });
  }

  // Replay detection
  const seen = pruneSeen(readSeen(), reg.replayTtl);
  if (seen[sig!] !== undefined) {
    console.warn(`[webhook] Replay detected — endpoint ${id.slice(0, 8)}`);
    return new Response("Conflict", { status: 409, headers: SECURE_HEADERS });
  }
  seen[sig!] = Date.now();
  writeSeen(seen);

  // Build stdin payload
  const headersObj: Record<string, string> = {};
  req.headers.forEach((v, k) => { headersObj[k] = v; });
  const payload = JSON.stringify({ method: req.method, headers: headersObj, body: bodyBuf.toString("utf8") });

  // Fire-and-forget
  const proc = Bun.spawn(["sh", "-c", reg.cmd], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  proc.stdin.write(payload);
  proc.stdin.end();
  proc.exited.then((code) => {
    if (code !== 0) console.error(`[webhook] Handler for ${id.slice(0, 8)} exited ${String(code)}`);
  }).catch(() => {});

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...SECURE_HEADERS, "Content-Type": "application/json" },
  });
}

// ── Subcommand: register ──────────────────────────────────────────────────────

async function cmdRegister(argv: string[]): Promise<void> {
  const args = parseArgs(argv);

  const secret = typeof args["secret"] === "string" ? args["secret"].trim() : "";
  const cmd    = typeof args["cmd"]    === "string" ? args["cmd"].trim()    : "";
  const name   = typeof args["name"]   === "string" ? args["name"].trim()   : undefined;

  if (!secret) { console.error("Error: --secret is required"); process.exit(1); }
  if (!cmd)    { console.error("Error: --cmd is required");    process.exit(1); }

  const signatureHeader   = typeof args["signature-header"]   === "string" ? args["signature-header"]   : "X-Hub-Signature-256";
  const signaturePrefix   = typeof args["signature-prefix"]   === "string" ? args["signature-prefix"]   : "sha256=";
  const rawEncoding       = typeof args["signature-encoding"] === "string" ? args["signature-encoding"] : "hex";
  const signatureEncoding = rawEncoding === "base64" ? "base64" as const : "hex" as const;
  const replayTtl         = typeof args["replay-ttl"] === "string" ? parseInt(args["replay-ttl"]) : DEFAULT_REPLAY_TTL;

  try {
    const res = await fetch(`http://localhost:${String(WEBHOOK_PORT)}/health`);
    if (!res.ok) throw new Error("unhealthy");
  } catch {
    console.error(`Error: webhook server not running on port ${String(WEBHOOK_PORT)}.`);
    console.error(`Start it: shell(background: true, command: "bun /app/skills/webhook server")`);
    process.exit(1);
  }

  const id      = randomBytes(32).toString("hex");
  const pattern = `/webhook/${id}`;

  try {
    await rpcCall("route.register", { pattern, target: `http://localhost:${String(WEBHOOK_PORT)}` });
  } catch {
    console.error("Error: could not register route with MCP server.");
    process.exit(1);
  }

  ensureStoreDir();
  const store = readRegistrations();
  store[id] = { id, name, secret, cmd, pattern, createdAt: Date.now(), signatureHeader, signaturePrefix, signatureEncoding, replayTtl };
  writeRegistrations(store);

  const url = `${baseUrl()}${pattern}`;
  console.log(`\n  ${url}\n`);
  console.log(`  🪝  ${name ?? "(unnamed)"}`);
  console.log(`  ⚙️   ${cmd}`);
  console.log(`  🔐  ${signatureHeader} (${signatureEncoding})`);
  console.log(`  ♻️   replay window: ${String(replayTtl)}s\n`);
}

// ── Subcommand: list ──────────────────────────────────────────────────────────

function cmdList(): void {
  const entries = Object.values(readRegistrations());
  if (entries.length === 0) { console.log("No registered endpoints."); return; }

  console.log(`\n  ${"ID".padEnd(10)}  ${"NAME".padEnd(16)}  ${"HEADER".padEnd(28)}  CMD`);
  console.log(`  ${"─".repeat(90)}`);
  for (const reg of entries) {
    console.log(`  ${(reg.id.slice(0, 8) + "…").padEnd(10)}  ${(reg.name ?? "—").padEnd(16)}  ${reg.signatureHeader.padEnd(28)}  ${reg.cmd}`);
  }
  console.log(`\n  ${String(entries.length)} endpoint(s) — ${baseUrl()}\n`);
}

// ── Subcommand: rm ────────────────────────────────────────────────────────────

async function cmdRm(argv: string[]): Promise<void> {
  const [query] = argv;
  if (!query) { console.error("Error: webhook rm requires an id prefix"); process.exit(1); }

  const store   = readRegistrations();
  const removed: Registration[] = [];

  for (const [id, reg] of Object.entries(store)) {
    if (id.startsWith(query)) {
      try { await rpcCall("route.unregister", { pattern: reg.pattern }); } catch { /* best effort */ }
      delete store[id];
      removed.push(reg);
    }
  }

  if (removed.length === 0) { console.error(`No endpoint found matching: ${query}`); process.exit(1); }

  writeRegistrations(store);
  for (const reg of removed) console.log(`Removed: ${reg.id.slice(0, 8)}… (${reg.name ?? reg.cmd})`);
}

// ── Entry point ───────────────────────────────────────────────────────────────

const [subcommand, ...rest] = process.argv.slice(2);

switch (subcommand) {
  case "server":   await cmdServer();        break;
  case "register": await cmdRegister(rest);  break;
  case "list":     cmdList();                break;
  case "rm":       await cmdRm(rest);        break;
  case "-h": case "--help": case "help": case undefined: printHelp(); break;
  default:
    console.error(`Unknown subcommand: ${subcommand}`);
    console.error("Run: bun /app/skills/webhook -h");
    process.exit(1);
}
