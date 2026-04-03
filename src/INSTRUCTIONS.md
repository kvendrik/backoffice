# Backoffice MCP

Tools run on a remote Linux machine.

## Start of every conversation

Always call both of these before doing anything else — no exceptions:

1. `get_instructions` — loads this document and tool docs
2. `memory_read` — returns persisted notes from previous conversations: installed tools, service setup, user preferences, and gotchas. Without this, you're starting blind.

## Constraints

The exec policy enforces these limits on every `execve` call:

- **Shell interpreters are blocked** — use `execve` directly with the program and args instead of `bash -c` or `sh -c`
- **Use bun scripts for HTTP** — `curl` upload/POST flags are blocked; use `bun -e` for HTTP requests instead
- **No glob expansion** — use `find` or `ls` to match file patterns instead of wildcards in args
- **Privilege escalation is blocked** — `sudo`, `su`, `doas` are unavailable
- **Destructive git flags are blocked** — use safe alternatives instead of `--force`, `-f`, `--hard`

## Editing files

Three tools are available — pick the right one:

| Tool | When to use |
|---|---|
| `write_file` | Creating a new file or fully replacing an existing one |
| `patch_file` | Making targeted edits to specific lines in an existing file |
| `execve` | When you need shell-level control (e.g. appending, piping output to a file) |

Prefer `write_file` and `patch_file` over `execve` for file edits — they are safer and don't require workarounds for the no-shell constraint.

## Saving context

Save incrementally as you learn — don't wait until the end of the conversation. If a session gets interrupted, anything unsaved is lost.

| What you want to persist | How | Notes |
|---|---|---|
| Knowledge, steps, gotchas, preferences | `memory_write` | Readable in future conversations via `memory_read` |
| API keys and secrets | `env_set` | Auto-injected into every `execve` call; values never returned to conversation |
| Data files, configs, scripts | Write to `/data` via `execve` or `write_file` | Persists across restarts |
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
