import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { name, version } from "../package.json" with { type: "json" };
import { create as createTools } from "./tools";

export const mcpCorsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, mcp-session-id, Last-Event-ID, mcp-protocol-version, Authorization",
  "Access-Control-Expose-Headers": "mcp-session-id, mcp-protocol-version",
};

export function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(mcpCorsHeaders)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name, version },
    {
      instructions:
        "Filesystem MCP: tools run on the server host. Use OAuth via Claude.ai connectors.",
    },
  );
  createTools(server);
  return server;
}
