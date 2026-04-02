import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod";

const NOTE_PATH = "/data/NOTE.md";

export function register(server: McpServer): void {
  server.registerTool(
    "note_write",
    {
      description:
        "Overwrite the persistent note file with new content. Use this to persist information across conversations — e.g. which CLIs are installed, useful paths, credentials locations, environment quirks, or anything else worth remembering for next time.",
      inputSchema: {
        content: z.string().describe("The full note content (markdown)"),
      },
    },
    async ({ content }) => {
      try {
        await mkdir(dirname(NOTE_PATH), { recursive: true });
        await writeFile(NOTE_PATH, content, "utf8");
        return {
          content: [{ type: "text" as const, text: "Note saved." }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: String(err) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "note_read",
    {
      description:
        "Read the persistent note file. Returns everything saved by previous conversations. You should call this at the start of every conversation to recall what you've learned about this machine.",
      inputSchema: {},
    },
    async () => {
      try {
        const body = await readFile(NOTE_PATH, "utf8");
        return {
          content: [{ type: "text" as const, text: body }],
        };
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return {
            content: [{ type: "text" as const, text: "No notes yet." }],
          };
        }
        return {
          content: [{ type: "text" as const, text: String(err) }],
          isError: true,
        };
      }
    },
  );
}
