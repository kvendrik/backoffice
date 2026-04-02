import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod";

const MEMORY_PATH = "/data/MEMORY.md";

export function register(server: McpServer): void {
  server.registerTool(
    "memory_read",
    {
      description:
        "Read the persistent memory file. Call this at the start of every conversation to recall context from previous conversations.",
      inputSchema: {},
    },
    async () => {
      try {
        const content = await readFile(MEMORY_PATH, "utf8");
        return {
          content: [{ type: "text" as const, text: content }],
        };
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return {
            content: [{ type: "text" as const, text: "No memory file exists yet." }],
          };
        }
        return {
          content: [{ type: "text" as const, text: String(err) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "memory_write",
    {
      description:
        "Write to the persistent memory file. Use this proactively to save anything useful across conversations: installed CLIs, useful paths, environment quirks, user preferences, and how to use specific tools, APIs, or services (steps, flags, gotchas, examples). Update whenever you learn something new.",
      inputSchema: {
        content: z.string().describe("The full markdown content to write to the memory file"),
      },
    },
    async ({ content }) => {
      try {
        await mkdir(dirname(MEMORY_PATH), { recursive: true });
        await writeFile(MEMORY_PATH, content);
        return {
          content: [{ type: "text" as const, text: `Memory updated (${MEMORY_PATH}).` }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: String(err) }],
          isError: true,
        };
      }
    },
  );
}
