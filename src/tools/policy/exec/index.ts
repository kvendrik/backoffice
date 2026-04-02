import { realpathSync } from "node:fs";
import { normalize, resolve } from "node:path";
import type { PolicyVerdict, ToolCallContext } from "../index";
import { DANGEROUS_COMMANDS } from "./dangerous";
import { ENV_PATH } from "../../env";

const ALLOW: PolicyVerdict = { allow: true, reason: null };

function deny(reason: string): PolicyVerdict {
  return { allow: false, reason };
}

function resolvesBinary(program: string, binaries: string[]): boolean {
  const located = Bun.which(program);
  if (located === null) return false;
  let resolved: string;
  try {
    resolved = realpathSync(located);
  } catch {
    resolved = located;
  }
  return binaries.some((bin) => resolved.endsWith(`/${bin}`));
}

function matchesFlags(args: string[], flags: string[]): boolean {
  return args.some((arg) => flags.some((f) => arg === f || arg.startsWith(f)));
}

/**
 * Path-based rm guard: allows `rm -r` in general but blocks it when any
 * target is `/` or a direct child of `/` (e.g. `/usr`, `/data`). This
 * prevents accidentally wiping the filesystem or a major directory while
 * still allowing normal cleanup at deeper paths like `/data/old-project`.
 * Only absolute paths are checked — relative paths are left alone.
 */
function hasRecursiveRmFlag(args: string[]): boolean {
  return args.some((arg) => {
    if (arg === "--recursive") return true;
    if (arg.startsWith("-") && !arg.startsWith("--")) {
      return arg.includes("r") || arg.includes("R");
    }
    return false;
  });
}

function targetsTopLevelPath(args: string[]): string | null {
  for (const arg of args) {
    if (arg.startsWith("-")) continue;
    if (!arg.startsWith("/")) continue;
    const segments = normalize(arg).split("/").filter(Boolean);
    if (segments.length <= 1) return arg;
  }
  return null;
}

function targetsEnvFile(args: string[], cwd?: string): boolean {
  return args.some((arg) => {
    if (arg.startsWith("-")) return false;
    const abs = arg.startsWith("/") ? normalize(arg) : normalize(resolve(cwd ?? "/", arg));
    return abs === ENV_PATH;
  });
}

function checkCommand(program: string, args: string[], cwd?: string): PolicyVerdict {
  if (targetsEnvFile(args, cwd)) {
    return deny(
      `access to the env secrets file is not allowed (got: ${program} ${args.join(" ")})`,
    );
  }

  if (resolvesBinary(program, ["rm"]) && hasRecursiveRmFlag(args)) {
    const broad = targetsTopLevelPath(args);
    if (broad !== null) {
      return deny(
        `recursive rm on top-level path "${broad}" is not allowed — use a more specific path (got: ${program} ${args.join(" ")})`,
      );
    }
  }

  for (const rule of DANGEROUS_COMMANDS) {
    if (!resolvesBinary(program, rule.binaries)) continue;
    if (rule.flags == null) {
      return deny(`${rule.reason} (got: ${program} ${args.join(" ")})`);
    }
    if (matchesFlags(args, rule.flags)) {
      return deny(`${rule.reason} (got: ${program} ${args.join(" ")})`);
    }
  }
  return ALLOW;
}

export function beforeCall(ctx: ToolCallContext): PolicyVerdict {
  const cwd = ctx.args["cwd"] as string | undefined;

  if (ctx.toolName === "execve") {
    const program = ctx.args["program"] as string;
    const args = (ctx.args["args"] ?? []) as string[];
    return checkCommand(program, args, cwd);
  }

  if (ctx.toolName === "execve_pipeline") {
    const commands = ctx.args["commands"] as {
      program: string;
      args: string[];
    }[];
    for (const cmd of commands) {
      const verdict = checkCommand(cmd.program, cmd.args, cwd);
      if (!verdict.allow) return verdict;
    }
  }

  if (ctx.toolName === "write_file") {
    const path = ctx.args["path"] as string;
    const abs = path.startsWith("/") ? normalize(path) : normalize(resolve(cwd ?? "/", path));
    if (abs === ENV_PATH) {
      return deny("writing to the env secrets file is not allowed — use env_set instead");
    }
  }

  return ALLOW;
}
