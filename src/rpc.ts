/**
 * rpc.ts — Internal Unix-socket JSON-RPC server
 *
 * Listens on SOCKET_PATH (process-local, never publicly reachable).
 * Other local processes (e.g. skills/share) connect to register HTTP routes
 * that the main Bun server then proxies.
 *
 * Security:
 *   - The Unix socket itself is the trust boundary — only local processes can reach it.
 *   - Route targets must be http://localhost:<port> or http://127.0.0.1:<port>.
 *   - Route patterns must start with an allowed prefix (ALLOWED_PATTERNS).
 *
 * Supported methods:
 *   route.register   { pattern: string, target: string }
 *   route.unregister { pattern: string }
 */

import { createServer } from "node:net";
import { existsSync, unlinkSync } from "node:fs";

export const SOCKET_PATH = "/tmp/backoffice.sock";

const ALLOWED_PATTERNS = ["/share", "/webhook"];
const LOCALHOST_TARGET = /^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/;

/** pattern (e.g. "/share") → target base URL (e.g. "http://localhost:3001") */
export const routeRegistry = new Map<string, string>();

function isAllowedPattern(pattern: string): boolean {
  return ALLOWED_PATTERNS.some((p) => pattern === p || pattern.startsWith(p + "/"));
}

function isAllowedTarget(target: string): boolean {
  return LOCALHOST_TARGET.test(target);
}

export function startRpcServer(): void {
  if (existsSync(SOCKET_PATH)) unlinkSync(SOCKET_PATH);

  const server = createServer((socket) => {
    let buf = "";

    socket.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let msg: unknown;
        try { msg = JSON.parse(trimmed); } catch { continue; }
        const reply = handleRpc(msg);
        socket.write(JSON.stringify(reply) + "\n");
      }
    });

    socket.on("error", () => { /* ignore client disconnects */ });
  });

  server.listen(SOCKET_PATH, () => {
    console.log(`[rpc] Listening on ${SOCKET_PATH}`);
  });

  server.on("error", (err) => {
    console.error("[rpc] Socket server error:", err);
  });
}

type RpcParams = Record<string, string>;

interface RpcRequest {
  jsonrpc?: string;
  method?: string;
  params?: RpcParams;
  id?: unknown;
}

function handleRpc(msg: unknown): object {
  const req = msg as RpcRequest;
  const id = req.id ?? null;
  const params: RpcParams = req.params ?? {};

  if (req.method === "route.register") {
    const pattern = params["pattern"];
    const target  = params["target"];
    if (!pattern || !target) {
      return { jsonrpc: "2.0", error: { code: -32602, message: "pattern and target required" }, id };
    }
    if (!isAllowedPattern(pattern)) {
      return { jsonrpc: "2.0", error: { code: -32602, message: `pattern not allowed: ${pattern}` }, id };
    }
    if (!isAllowedTarget(target)) {
      return { jsonrpc: "2.0", error: { code: -32602, message: `target must be http://localhost:<port>` }, id };
    }
    routeRegistry.set(pattern, target);
    console.log(`[rpc] Registered route: ${pattern} → ${target}`);
    return { jsonrpc: "2.0", result: { ok: true }, id };
  }

  if (req.method === "route.unregister") {
    const pattern = params["pattern"];
    if (!pattern) {
      return { jsonrpc: "2.0", error: { code: -32602, message: "pattern required" }, id };
    }
    routeRegistry.delete(pattern);
    console.log(`[rpc] Unregistered route: ${pattern}`);
    return { jsonrpc: "2.0", result: { ok: true }, id };
  }

  return { jsonrpc: "2.0", error: { code: -32601, message: "Method not found" }, id };
}
