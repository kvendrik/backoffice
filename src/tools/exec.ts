import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod";
import { getAll as getPersistedEnv } from "./env";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576; // 1 MB

interface Session {
  cwd: string;
  env: Record<string, string>;
}

export function register(server: McpServer): void {
  const session: Session = { cwd: process.cwd(), env: {} };
  server.registerTool(
    "execve",
    {
      description:
        "Executes a program directly (no shell). The program is resolved via PATH and called with the given argv. Working directory and environment persist across calls. No glob expansion — use find/ls to match patterns instead of wildcards in args. Important: Always call get_instructions and memory_read before using this tool.",
      inputSchema: {
        program: z.string().describe("Executable name or path"),
        args: z.array(z.string()).default([]).describe("Argument vector"),
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
      },
    },
    async ({ program, args, cwd, env, timeout_ms, max_output_bytes }) => {
      const err = applySessionUpdates(session, cwd, env);
      if (err !== null) return formatError(err);
      const { stdout, stderr, code } = await runExec(
        program,
        args,
        session,
        timeout_ms,
        max_output_bytes,
      );
      return formatResult(stdout, stderr, code, session);
    },
  );

  server.registerTool(
    "execve_pipeline",
    {
      description:
        "Executes a pipeline of programs, piping stdout of each into stdin of the next. Each stage uses execve semantics (no shell). Working directory and environment persist across calls. Important: Always call get_instructions and memory_read before using this tool.",
      inputSchema: {
        commands: z
          .array(
            z.object({
              program: z.string().describe("Executable name or path"),
              args: z.array(z.string()).default([]).describe("Argument vector"),
            }),
          )
          .min(1)
          .describe("Ordered list of commands to pipe together"),
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
      },
    },
    async ({ commands, cwd, env, timeout_ms, max_output_bytes }) => {
      const err = applySessionUpdates(session, cwd, env);
      if (err !== null) return formatError(err);
      const { stdout, stderr, code } = await runPipeline(
        commands,
        session,
        timeout_ms,
        max_output_bytes,
      );
      return formatResult(stdout, stderr, code, session);
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
  return { ...process.env, ...getPersistedEnv(), ...session.env };
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

function runExec(
  program: string,
  args: string[],
  session: Session,
  timeoutMs: number,
  maxOutputBytes: number,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(program, args, {
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

function runPipeline(
  commands: { program: string; args: string[] }[],
  session: Session,
  timeoutMs: number,
  maxOutputBytes: number,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const first = commands[0];
  if (first !== undefined && commands.length === 1)
    return runExec(first.program, first.args, session, timeoutMs, maxOutputBytes);

  const env = sessionEnv(session);
  return new Promise((resolve) => {
    const children: ChildProcess[] = commands.map((cmd, i) =>
      spawn(cmd.program, cmd.args, {
        stdio: [i === 0 ? "ignore" : "pipe", "pipe", "pipe"],
        cwd: session.cwd,
        env,
      }),
    );

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      for (const child of children) child.kill("SIGKILL");
    }, timeoutMs);

    for (let i = 0; i < children.length - 1; i++) {
      const cur = children[i];
      const next = children[i + 1];
      if (cur === undefined || next === undefined) continue;
      const out = cur.stdout;
      const inp = next.stdin;
      if (out !== null && inp !== null) out.pipe(inp);
    }

    const stdout = cappedCollector(maxOutputBytes);
    const stderr = cappedCollector(maxOutputBytes);
    const last = children[children.length - 1];

    for (const child of children) {
      if (child.stderr === null) continue;
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr.append(chunk);
      });
    }

    if (last !== undefined && last.stdout !== null) {
      last.stdout.setEncoding("utf8");
      last.stdout.on("data", (chunk: string) => {
        stdout.append(chunk);
      });
    }

    let exitCode: number | null = null;
    let remaining = children.length;

    const onDone = () => {
      remaining--;
      if (remaining > 0) return;
      clearTimeout(timer);
      let stderrVal = stderr.value();
      if (timedOut) {
        stderrVal = `pipeline timed out after ${String(timeoutMs)}ms (increase timeout_ms for long-running commands)\n${stderrVal}`;
      }
      resolve({ stdout: stdout.value(), stderr: stderrVal, code: timedOut ? 1 : exitCode });
    };

    for (const child of children) {
      child.on("close", (code) => {
        if (child === last) exitCode = code;
        onDone();
      });
      child.on("error", (err) => {
        stderr.append(`\n${String(err)}`);
        if (child === last) exitCode = 1;
        onDone();
      });
    }
  });
}
