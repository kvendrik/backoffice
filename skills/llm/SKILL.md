---
name: llm
description: Run an async agentic task using the same tools available in this session. Use this to delegate long-running or multi-step work that should happen in the background — e.g. "run a full cycling progress update", "research and summarise X", "execute this plan while I do something else".
---

# LLM Skill

Spins up a second agent connected to this MCP server. The sub-agent has access to all the same tools (`shell`, `memory_read/write`, `patch_file`, etc.) and the same system instructions. Use it to delegate async work — fire it off in the background and let it run independently.

## Usage

```bash
bun /app/skills/llm/scripts/llm.ts "<prompt>"
```

For async / background execution:

```bash
shell(background: true, command: 'bun /app/skills/llm/scripts/llm.ts "your prompt here"')
```

## Options

| Flag | Default | Description |
|---|---|---|
| `-p, --provider <name>` | `anthropic` | LLM provider (`anthropic`, `openai`) |
| `-m, --model <id>` | `claude-sonnet-4-6` | Model ID |

```bash
bun /app/skills/llm/scripts/llm.ts --model claude-haiku-4-5 "summarise the TODO list"
bun /app/skills/llm/scripts/llm.ts --provider openai --model gpt-4o "..."
```

## How it works

- Connects to the MCP server at `http://127.0.0.1:<PORT>/mcp` (localhost — no auth required)
- Uses the same `INSTRUCTIONS.md` as system prompt
- Runs a full agentic loop via `mcp-use` + LangChain until the task is complete
- `PORT` defaults to `3000`; override with the `PORT` env var if needed

## Gotchas

- The MCP server must be running before invoking this skill (it always is in normal operation)
- Run with `background: true` for long tasks so the current session isn't blocked
- The sub-agent shares the same `/data/MEMORY.md` and filesystem — changes it makes are real
- stdout = final answer; stderr = tool call progress (only visible if not run in background)
