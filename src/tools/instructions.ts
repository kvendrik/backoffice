import { readFileSync } from "node:fs";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function register(server: McpServer): void {
  server.registerTool(
    "get_instructions",
    {
      description:
        "Get the full system instructions for this MCP server. Call this at the start of every conversation before using any other tool.",
      inputSchema: {},
    },
    () => ({
      content: [
        {
          type: "text" as const,
          text: readFileSync(join(__dirname, "..", "INSTRUCTIONS.md"), "utf8").trim(),
        },
      ],
    }),
  );
}
