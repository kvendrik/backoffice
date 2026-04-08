import { spawn } from "node:child_process";
import { existsSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod";
import { getAll as getPersistedEnv } from "./env";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576; // 1 MB

interface Session {
  cwd: string;
  env: Record<string, string>;
}

const JOBS_FILE = "/.background-jobs";

interface BackgroundJob {
  id: number;
  pid: number;
  command: string;
  cwd: string;
  startedAt: string;
}

function readJobs(): BackgroundJob[] {
  try {
    return JSON.parse(readFileSync(JOBS_FILE, "utf8")) as BackgroundJob[];
  } catch {
    return [];
  }
}

function writeJobs(jobs: BackgroundJob[]): void {
  try {
    writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2));
  } catch {
    // /tmp fallback if root isn't writable
    writeFileSync(JOBS_FILE.replace("/.", "/tmp/."), JSON.stringify(jobs, null, 2));
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function register(server: McpServer): void {
  const session: Session = { cwd: process.cwd(), env: {} };

  server.registerTool(
    "shell",
    {
      description:
        "Runs a bash command. Working directory and environment persist across calls. Important: Always call get_instructions and memory_read before using this tool.",
      inputSchema: {
        command: z.string().describe("Bash command to run"),
        cwd: z.string().optional().describe("Working directory. Persists for subsequent calls."),
        env: z
          .record(z.string(), z.string())
          .optional()
          .describe("Environment variables to set. Merged into session env and persists."),
        timeout_ms: z
          .number()
          .int()
          .positive()
          .default(DEFAULT_TIMEOUT_MS)
          .describe(
            "Timeout in milliseconds. Defaults to 30000 (30s). Increase for long-running commands.",
          ),
        max_output_bytes: z
          .number()
          .int()
          .positive()
          .default(DEFAULT_MAX_OUTPUT_BYTES)
          .describe(
            "Max bytes captured per stream (stdout/stderr). Defaults to 1048576 (1 MB). Increase for commands that produce large output.",
          ),
        background: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            "Run the command in the background without waiting for it to complete. Returns immediately with the PID. No stdout/stderr is captured. Useful for long-running servers or daemons.",
          ),
      },
    },
    async ({ command, cwd, env, timeout_ms, max_output_bytes, background }) => {
      const err = applySessionUpdates(session, cwd, env);
      if (err !== null) return formatError(err);
      if (background) {
        const pid = runBackground(command, session);
        const jobs = readJobs();
        const id = (jobs.length > 0 ? Math.max(...jobs.map((j) => j.id)) : 0) + 1;
        jobs.push({ id, pid, command, cwd: session.cwd, startedAt: new Date().toISOString() });
        writeJobs(jobs);
        return {
          content: [{ type: "text" as const, text: `cwd: ${session.cwd}\nStarted in background [job ${String(id)}] (PID: ${String(pid)})\n\nUse shell_list_background_jobs to see all running jobs.\nTo stop: kill ${String(pid)}` }],
        };
      }
      const { stdout, stderr, code } = await runShell(command, session, timeout_ms, max_output_bytes);
      return formatResult(stdout, stderr, code, session);
    },
  );

  server.registerTool(
    "shell_list_background_jobs",
    {
      description:
        "Lists all background jobs started with shell(background: true). Automatically prunes jobs whose processes are no longer running.",
      inputSchema: {},
    },
    () => {
      const all = readJobs();
      const alive = all.filter((j) => isAlive(j.pid));
      if (alive.length !== all.length) writeJobs(alive);

      if (alive.length === 0) {
        return { content: [{ type: "text" as const, text: `No background jobs running.\n(Jobs file: ${JOBS_FILE})` }] };
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

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );
}

function applySessionUpdates(
  session: Session,
  cwd: string | undefined,
  env: Record<string, string> | undefined,
): string | null {
  if (cwd !== undefined) {
    if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
      return `cwd does not exist or is not a directory: ${cwd}`;
    }
    session.cwd = cwd;
  }
  if (env !== undefined) Object.assign(session.env, env);
  return null;
}

function formatError(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

function formatResult(stdout: string, stderr: string, code: number | null, session: Session) {
  const exitLabel = code === null ? "null" : String(code);
  const lines = [`cwd: ${session.cwd}`, `exit code: ${exitLabel}`];
  if (stdout.length > 0) lines.push("", "stdout:", stdout);
  if (stderr.length > 0) lines.push("", "stderr:", stderr);
  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
    isError: code !== 0,
  };
}

function sessionEnv(session: Session): NodeJS.ProcessEnv {
  const base = { ...process.env, ...getPersistedEnv(), ...session.env };
  const existingPath = base["PATH"] ?? "";
  const persistedPaths = "/data/bun/bin:/data/homebrew/bin:/data/homebrew/sbin";
  return {
    ...base,
    BUN_INSTALL: base["BUN_INSTALL"] ?? "/data/bun",
    HOMEBREW_PREFIX: base["HOMEBREW_PREFIX"] ?? "/data/homebrew",
    HOMEBREW_CELLAR: base["HOMEBREW_CELLAR"] ?? "/data/homebrew/Cellar",
    HOMEBREW_REPOSITORY: base["HOMEBREW_REPOSITORY"] ?? "/data/homebrew",
    PATH: existingPath ? `${persistedPaths}:${existingPath}` : persistedPaths,
  };
}

function cappedCollector(maxBytes: number) {
  let buf = "";
  let bytes = 0;
  let truncated = false;
  const append = (chunk: string): void => {
    if (truncated) return;
    bytes += Buffer.byteLength(chunk, "utf8");
    if (bytes > maxBytes) {
      truncated = true;
      return;
    }
    buf += chunk;
  };
  const value = (): string => {
    if (truncated)
      return `${buf}\n… output truncated (exceeded ${String(maxBytes)} bytes, increase max_output_bytes) …`;
    return buf;
  };
  return { append, value };
}

function runBackground(command: string, session: Session): number {
  const child = spawn("bash", ["-c", command], {
    stdio: "ignore",
    cwd: session.cwd,
    env: sessionEnv(session),
    detached: true,
  });
  child.unref();
  return child.pid ?? -1;
}

function runShell(
  command: string,
  session: Session,
  timeoutMs: number,
  maxOutputBytes: number,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-c", command], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: session.cwd,
      env: sessionEnv(session),
    });
    const stdout = cappedCollector(maxOutputBytes);
    const stderr = cappedCollector(maxOutputBytes);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout.append(chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr.append(chunk);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      let stderrVal = stderr.value();
      if (timedOut) {
        stderrVal = `process timed out after ${String(timeoutMs)}ms (increase timeout_ms for long-running commands)\n${stderrVal}`;
      }
      resolve({ stdout: stdout.value(), stderr: stderrVal, code: timedOut ? 1 : code });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ stdout: stdout.value(), stderr: `${stderr.value()}\n${String(err)}`, code: 1 });
    });
  });
}
