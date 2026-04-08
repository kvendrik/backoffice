import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { register as registerShell } from "./shell";
import { register as registerPatch } from "./patch";
import { register as registerEnv } from "./env";
import { register as registerMemory } from "./memory";
import { register as registerInstructions } from "./instructions";

export function create(server: McpServer): void {
  applyLogging(server);
  registerShell(server);
  registerPatch(server);
  registerEnv(server);
  registerMemory(server);
  registerInstructions(server);
}

const LOG_FILE = path.join("/data", "log.jsonl");

interface ToolCallContext {
  toolName: string;
  args: Record<string, unknown>;
  oauth?: {
    clientId: string;
    clientName: string;
    redirectUris: string[];
  };
  sessionId?: string;
}

function applyLogging(server: McpServer): void {
  // registerTool is a generic overloaded method on McpServer. Wrapping it
  // requires erasing type parameters at the interception boundary; the
  // handler and logging calls themselves remain typed via CallToolResult.
  /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
  const orig: (...a: any[]) => any = server.registerTool.bind(server);

  const patched = (name: string, config: any, cb: any): any =>
    orig(name, config, async (args: any, extra: any): Promise<CallToolResult> => {
      const rawArgs = args as Record<string, unknown>;
      const ctx: ToolCallContext = {
        toolName: name,
        args: name === "env_set" ? { ...rawArgs, value: "[redacted]" } : rawArgs,
        ...(extra.authInfo != null
          ? {
              oauth: {
                clientId: extra.authInfo.clientId,
                clientName: extra.authInfo.extra?.client_name,
                redirectUris: extra.authInfo.extra?.redirect_uris,
              },
            }
          : {}),
        ...(extra.sessionId != null ? { sessionId: extra.sessionId } : {}),
      };

      const callId = nanoid();

      fs.appendFileSync(
        LOG_FILE,
        JSON.stringify({
          callId,
          type: "tool_call",
          timestamp: new Date().toISOString(),
          call: ctx,
        }) + "\n",
      );

      const result: CallToolResult = (await cb(args, extra)) as CallToolResult;

      fs.appendFileSync(
        LOG_FILE,
        JSON.stringify({
          callId,
          type: "tool_result",
          timestamp: new Date().toISOString(),
          result,
        }) + "\n",
      );

      return result;
    });

  (server as any).registerTool = patched;
  /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
}
