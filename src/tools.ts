import { spawn } from "node:child_process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod";

export function create(server: McpServer): void {
  server.registerTool(
    "exec",
    {
      description:
        "Runs a shell command with /bin/bash -c on the MCP server host. Full access to the server environment; use only in trusted setups.",
      inputSchema: { command: z.string().describe("Bash command to run (passed to bash -c)") },
    },
    async ({ command }) => {
      const { stdout, stderr, code } = await runBash(command);
      const exitLabel = code === null ? "null" : String(code);
      const lines = [`exit code: ${exitLabel}`];
      if (stdout.length > 0) lines.push("", "stdout:", stdout);
      if (stderr.length > 0) lines.push("", "stderr:", stderr);
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        isError: code !== 0,
      };
    },
  );
}

function runBash(
  command: string,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn("/bin/bash", ["-c", command], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      resolve({ stdout, stderr, code });
    });
    child.on("error", (err) => {
      resolve({ stdout, stderr: `${stderr}\n${String(err)}`, code: 1 });
    });
  });
}
