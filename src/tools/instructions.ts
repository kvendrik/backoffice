import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const instructions = readFileSync(new URL("INSTRUCTIONS.md", import.meta.url), "utf8").trim();

export function register(server: McpServer): void {
  server.registerTool(
    "get_instructions",
    {
      description:
        "Get the full system instructions for this MCP server. Call this if you're unsure how to use the available tools or need guidance on conventions.",
      inputSchema: {},
    },
    () => ({
      content: [{ type: "text" as const, text: instructions }],
    }),
  );
}
