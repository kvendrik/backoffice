import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readJobs, writeJobs, JOBS_FILE } from "./shell";

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function register(server: McpServer): void {
  server.registerTool(
    "shell_list_background_jobs",
    {
      description:
        "Lists all background jobs started with shell(background: true). Automatically prunes jobs whose processes are no longer running. Jobs are persisted to /.background-jobs and survive MCP session restarts (but not container restarts, since the processes themselves don't survive those).",
      inputSchema: {},
    },
    () => {
      const all = readJobs();
      const alive = all.filter((j) => isAlive(j.pid));

      if (alive.length !== all.length) {
        writeJobs(alive);
      }

      if (alive.length === 0) {
        return {
          content: [{ type: "text" as const, text: `No background jobs running.\n(Jobs file: ${JOBS_FILE})` }],
        };
      }

      const lines = ["BACKGROUND JOBS", "─".repeat(60)];
      for (const j of alive) {
        const started = new Date(j.startedAt).toLocaleString();
        lines.push(`[${String(j.id)}] PID ${String(j.pid)}  started ${started}`);
        lines.push(`    ${j.command}`);
        lines.push(`    cwd: ${j.cwd}`);
      }
      lines.push("─".repeat(60));
      lines.push(`${String(alive.length)} job(s) running  ·  To stop: kill <PID>`);

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    },
  );
}
