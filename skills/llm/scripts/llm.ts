#!/usr/bin/env bun
// Agentic CLI — connects to the local MCP server and uses its tools.
// Usage: bun bin/llm.ts [--provider <provider>] [--model <model>] "<prompt>"
//        echo "<prompt>" | bun bin/llm.ts

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
process.env["MCP_USE_ANONYMIZED_TELEMETRY"] = "false";
import { MCPAgent, MCPClient } from "mcp-use";

const program = new Command()
  .name("llm")
  .description("Agentic CLI — connects to the Backoffice MCP server using its tools")
  .argument("[prompt...]", "Prompt to send (reads from stdin if omitted)")
  .option("-p, --provider <provider>", "LLM provider (anthropic, openai)", "anthropic")
  .option("-m, --model <model>", "Model ID (e.g. claude-sonnet-4-6, gpt-4o)", "claude-sonnet-4-6")
  .parse(process.argv);

const opts = program.opts<{ provider: string; model: string }>();

async function resolvePrompt(): Promise<string> {
  if (program.args.length > 0) return program.args.join(" ");
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (text === "") program.help();
  return text;
}

const API_KEY_ENV: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

async function createLLM(provider: string, model: string) {
  const envVar = API_KEY_ENV[provider];
  if (envVar !== undefined && !process.env[envVar]) {
    console.error(`Error: ${envVar} is not set. Export it and try again.`);
    process.exit(1);
  }
  switch (provider) {
    case "anthropic": {
      const { ChatAnthropic } = await import("@langchain/anthropic");
      return new ChatAnthropic({ model });
    }
    case "openai": {
      const { ChatOpenAI } = await import("@langchain/openai");
      return new ChatOpenAI({ model });
    }
    default:
      throw new Error(`Unsupported provider: ${provider}. Supported: anthropic, openai`);
  }
}

async function main() {
  const prompt = await resolvePrompt();
  const port = process.env["PORT"] ?? "3000";

  const client = MCPClient.fromDict({
    mcpServers: {
      backoffice: { url: `http://127.0.0.1:${port}/mcp` },
    },
  });

  const systemPrompt = readFileSync(
    join(import.meta.dir, "../../../src/INSTRUCTIONS.md"),
    "utf8",
  ).trim();

  const llm = await createLLM(opts.provider, opts.model);
  const agent = new MCPAgent({ llm, client, systemPrompt, maxSteps: 50 });

  const result = await agent.run({ prompt });
  console.log(result);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
