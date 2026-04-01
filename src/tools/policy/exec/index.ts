import { realpathSync } from "node:fs";
import type { PolicyVerdict, ToolCallContext } from "../index";
import { DANGEROUS_COMMANDS } from "./dangerous";

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

function checkCommand(program: string, args: string[]): PolicyVerdict {
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
  if (ctx.toolName === "execve") {
    const program = ctx.args["program"] as string;
    const args = (ctx.args["args"] ?? []) as string[];
    return checkCommand(program, args);
  }

  if (ctx.toolName === "execve_pipeline") {
    const commands = ctx.args["commands"] as {
      program: string;
      args: string[];
    }[];
    for (const cmd of commands) {
      const verdict = checkCommand(cmd.program, cmd.args);
      if (!verdict.allow) return verdict;
    }
  }

  return ALLOW;
}
