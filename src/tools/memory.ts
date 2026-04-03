import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import { dirname } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod";
import { applyPatch, parsePatch } from "./patch";

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

  server.registerTool(
    "memory_patch",
    {
      description:
        "Apply a targeted patch to the persistent memory file. Uses the same *** Begin Patch format as patch_file but always targets /data/MEMORY.md. Use this for small updates (fixing a stale entry, adding a note, removing outdated info) without rewriting the whole file.",
      inputSchema: {
        patch: z
          .string()
          .describe(
            'Patch string in "*** Begin Patch" format. The file path in the patch must be /data/MEMORY.md.',
          ),
      },
    },
    async ({ patch }) => {
      try {
        const parsed = parsePatch(patch);
        if (parsed.filePath !== MEMORY_PATH) {
          return {
            content: [{ type: "text" as const, text: `memory_patch only targets ${MEMORY_PATH} — got: ${parsed.filePath}` }],
            isError: true,
          };
        }
        await applyPatch(patch);
        return {
          content: [{ type: "text" as const, text: "Memory patched." }],
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
    "memory_append",
    {
      description:
        "Append content to the end of the persistent memory file. Use this when adding new information — installed tools, service setup steps, user preferences, gotchas. Simpler and safer than memory_patch for additions: no format overhead, no context-mismatch risk.",
      inputSchema: {
        content: z.string().describe("Markdown content to append to the memory file. Will be added on a new line."),
      },
    },
    async ({ content }) => {
      try {
        await mkdir(dirname(MEMORY_PATH), { recursive: true });
        await appendFile(MEMORY_PATH, "\n" + content, "utf8");
        return {
          content: [{ type: "text" as const, text: "Memory updated." }],
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
