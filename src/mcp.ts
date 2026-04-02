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
        "Backoffice MCP: tools run on a remote Linux machine. Always start by calling note_read to recall information saved by previous conversations (e.g. installed CLIs, useful paths, environment details). Save anything worth remembering for next time with note_write.",
    },
  );
  createTools(server);
  return server;
}
