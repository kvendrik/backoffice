import { spawn, type ChildProcess } from "node:child_process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod";

export function register(server: McpServer): void {
  server.registerTool(
    "execve",
    {
      description:
        "Executes a program directly (no shell). The program is resolved via PATH and called with the given argv.",
      inputSchema: {
        program: z.string().describe("Executable name or path"),
        args: z.array(z.string()).default([]).describe("Argument vector"),
      },
    },
    async ({ program, args }) => {
      const { stdout, stderr, code } = await runExec(program, args);
      return formatResult(stdout, stderr, code);
    },
  );

  server.registerTool(
    "execve_pipeline",
    {
      description:
        "Executes a pipeline of programs, piping stdout of each into stdin of the next. Each stage uses execve semantics (no shell).",
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
      },
    },
    async ({ commands }) => {
      const { stdout, stderr, code } = await runPipeline(commands);
      return formatResult(stdout, stderr, code);
    },
  );
}

function formatResult(stdout: string, stderr: string, code: number | null) {
  const exitLabel = code === null ? "null" : String(code);
  const lines = [`exit code: ${exitLabel}`];
  if (stdout.length > 0) lines.push("", "stdout:", stdout);
  if (stderr.length > 0) lines.push("", "stderr:", stderr);
  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
    isError: code !== 0,
  };
}

function runExec(
  program: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(program, args, {
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

function runPipeline(
  commands: { program: string; args: string[] }[],
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const first = commands[0];
  if (first !== undefined && commands.length === 1)
    return runExec(first.program, first.args);

  return new Promise((resolve) => {
    const children: ChildProcess[] = commands.map((cmd, i) =>
      spawn(cmd.program, cmd.args, {
        stdio: [i === 0 ? "ignore" : "pipe", "pipe", "pipe"],
        env: process.env,
      }),
    );

    for (let i = 0; i < children.length - 1; i++) {
      const cur = children[i];
      const next = children[i + 1];
      if (cur === undefined || next === undefined) continue;
      const out = cur.stdout;
      const inp = next.stdin;
      if (out !== null && inp !== null) out.pipe(inp);
    }

    let stdout = "";
    let stderr = "";
    const last = children[children.length - 1];

    for (const child of children) {
      if (child.stderr === null) continue;
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
    }

    if (last !== undefined && last.stdout !== null) {
      last.stdout.setEncoding("utf8");
      last.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
    }

    let exitCode: number | null = null;
    let remaining = children.length;

    const onDone = () => {
      remaining--;
      if (remaining === 0) resolve({ stdout, stderr, code: exitCode });
    };

    for (const child of children) {
      child.on("close", (code) => {
        if (child === last) exitCode = code;
        onDone();
      });
      child.on("error", (err) => {
        stderr += `\n${String(err)}`;
        if (child === last) exitCode = 1;
        onDone();
      });
    }
  });
}
