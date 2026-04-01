import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { beforeCall as execBeforeCall } from "./exec";

export interface ToolCallContext {
  toolName: string;
  args: Record<string, unknown>;
}

export type PolicyVerdict = { allow: true; reason: null } | { allow: false; reason: string };

export interface Policy {
  beforeCall(ctx: ToolCallContext): PolicyVerdict | Promise<PolicyVerdict>;
  afterCall(ctx: ToolCallContext, result: CallToolResult): PolicyVerdict | Promise<PolicyVerdict>;
}

const ALLOW: PolicyVerdict = { allow: true, reason: null };

export const policy: Policy = {
  beforeCall(ctx) {
    return execBeforeCall(ctx);
  },
  afterCall() {
    return ALLOW;
  },
};
