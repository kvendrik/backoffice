import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod";

export function register(server: McpServer): void {
  server.registerTool(
    "write_file",
    {
      description:
        "Writes text content to a file. Creates the file and any missing parent directories. Overwrites existing content by default. For reading, listing, moving, or deleting paths, use execve (e.g. cat, ls, mv, rm).",
      inputSchema: {
        path: z.string().describe("Absolute or relative file path"),
        content: z.string().describe("Text content to write"),
        append: z
          .boolean()
          .default(false)
          .describe("If true, append to the file instead of overwriting"),
      },
    },
    async ({ path, content, append }) => {
      try {
        const resolved = resolve(path);
        await mkdir(dirname(resolved), { recursive: true });
        await writeFile(resolved, content, {
          flag: append ? "a" : "w",
        });
        return {
          content: [
            {
              type: "text" as const,
              text: `${append ? "Appended to" : "Wrote"} ${resolved}`,
            },
          ],
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
