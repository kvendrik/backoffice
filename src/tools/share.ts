import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod";
import { registerFile, remainingMs } from "../sharing";

// Derive public base URL the same way index.ts does
function getBaseUrl(): string {
  const raw = process.env["PUBLIC_BASE_URL"]?.trim();
  if (raw !== undefined && raw !== "") return new URL(raw).origin;
  const railway = process.env["RAILWAY_PUBLIC_DOMAIN"]?.trim();
  if (railway !== undefined && railway !== "") return `https://${railway}`;
  const port = process.env["PORT"] ?? "3000";
  return `http://127.0.0.1:${port}`;
}

export function register(server: McpServer): void {
  server.registerTool(
    "share_file",
    {
      description:
        "Temporarily expose a file over HTTP for 10 minutes. Returns a one-time URL the user can open in their browser. Use this for images, PDFs, binaries, or any non-text file you want to hand off to the user. The file is never stored externally — it's served directly from this machine and the link expires automatically.",
      inputSchema: {
        file_path: z.string().describe("Absolute path to the file to share"),
      },
    },
    async ({ file_path }) => {
      if (!existsSync(file_path)) {
        return {
          content: [{ type: "text", text: `Error: file not found: ${file_path}` }],
        };
      }

      const stat = statSync(file_path);
      if (!stat.isFile()) {
        return {
          content: [{ type: "text", text: `Error: path is not a file: ${file_path}` }],
        };
      }

      const filename = path.basename(file_path);
      const token = registerFile(file_path, filename);
      const url = `${getBaseUrl()}/share/${token}`;
      const ms = remainingMs(token) ?? 0;
      const mins = Math.round(ms / 60000);

      return {
        content: [
          {
            type: "text",
            text: [
              `✅ File shared: **${filename}**`,
              `🔗 URL: ${url}`,
              `⏱ Expires in: ${mins} minutes`,
              ``,
              `Open the URL in your browser to download the file.`,
              `The link is single-use and self-destructs after download or expiry.`,
            ].join("\n"),
          },
        ],
      };
    },
  );
}
