/**
 * rpc.ts — Internal Unix-socket JSON-RPC server
 *
 * Listens on SOCKET_PATH (process-local, never publicly reachable).
 * Other local processes (e.g. skills/share) connect to register HTTP routes
 * that the main Bun server then proxies.
 *
 * Supported methods:
 *   route.register   { pattern: string, target: string }
 *   route.unregister { pattern: string }
 */

import { createServer } from "node:net";
import { existsSync, unlinkSync } from "node:fs";

export const SOCKET_PATH = "/tmp/backoffice.sock";

/** pattern (e.g. "/share") → target base URL (e.g. "http://localhost:3001") */
export const routeRegistry = new Map<string, string>();

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
