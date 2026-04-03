# Backoffice MCP

Tools run on a remote Linux machine.

## Start of every conversation

Always call both of these before doing anything else — no exceptions:

1. `get_instructions` — loads this document and tool docs
2. `memory_read` — returns persisted notes from previous conversations: installed tools, service setup, user preferences, and gotchas. Without this, you're starting blind.

## Constraints

- **No glob expansion in shell** — bash globs expand against the local filesystem as expected, but prefer `find` or `ls` for explicit file matching when results need to be predictable
- **Privilege escalation is unavailable** — the server runs as a non-root user; `sudo` is not installed
- **Destructive git flags** — avoid `--force`, `-f`, `--hard` unless explicitly needed

## Editing files

Use `patch_file` for targeted edits to specific lines in large files — it's safer than a full rewrite and doesn't require reading the whole file first. For everything else (creating files, full rewrites, appending), use the shell.

## Saving context

Save incrementally as you learn — don't wait until the end of the conversation. If a session gets interrupted, anything unsaved is lost.

| What you want to persist | How | Notes |
|---|---|---|
| Knowledge, steps, gotchas, preferences | `memory_write` | Readable in future conversations via `memory_read` |
| API keys and secrets | `env_set` | Auto-injected into every `shell` call; values never returned to conversation |
| Data files, configs, scripts | Write to `/data` via shell | Persists across restarts |
| Packages (CLI tools, libraries) | `bun install -g` or `brew install` | Installs to `/data/bun` or `/data/homebrew`; persists across restarts |
| Anything else | Save steps to `memory_write` with **⚠ run after restart:** | Filesystem outside `/data` is wiped on restart |

### Memory structure

Organise `memory_write` content with these sections:

- **Environment** — stable facts about the machine
- **Installed tools** — only things that genuinely persist (in `/data` or globally installed)
- **Services** — per-service setup: credentials location, useful commands, gotchas, re-auth steps
- **User preferences**

**Rules:**
- Don't record ephemeral state (file paths outside `/data`, token files in `/root/`, runtime artifacts) as if it persists — save the steps to recreate it instead
- Label setup steps that must be re-run after a restart with **⚠ run after restart:**

## What survives restarts

| Thing | Survives? |
|---|---|
| Files in `/data` | Yes |
| `env_set` variables | Yes |
| `memory_write` content | Yes |
| `bun install -g` packages | Yes — installed to `/data/bun` |
| `brew install` packages | Yes — installed to `/data/homebrew` |
| Files outside `/data` | No |
| Everything else | No |
