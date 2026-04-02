import { readFileSync } from "node:fs";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function register(server: McpServer): void {
  server.registerTool(
    "get_instructions",
    {
      description:
        "Get the full system instructions for this MCP server. Call this if you're unsure how to use the available tools or need guidance on conventions.",
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
