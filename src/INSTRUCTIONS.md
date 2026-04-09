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

### Patch format

```
*** Begin Patch
*** Update File: /absolute/path/to/file
@@ optional hunk label
 context line (space prefix — must match file exactly)
-line to remove (minus prefix — must match file exactly)
+line to add (plus prefix)
*** End Patch
```

To create a new file use `*** Add File:` instead of `*** Update File:`. Context and removal lines must match the file character-for-character — a single mismatch fails the whole patch. Multiple hunks are supported; separate them with additional `@@` lines.

## Saving context

Save incrementally as you learn — don't wait until the end of the conversation. If a session gets interrupted, anything unsaved is lost.

| What you want to persist | How | Notes |
|---|---|---|
| Knowledge, steps, gotchas, preferences (full restructure) | `memory_write` | Replaces the entire memory file |
| Add new information | `memory_append` | Appends to the end — no format, no context required. Place content under the appropriate section header (Environment, Installed tools, Services, User preferences) so the file stays organised |
| Fix a stale entry, remove outdated info | `memory_patch` | Same patch format as `patch_file`. The path in the patch must be `/data/MEMORY.md` |
| API keys and secrets | `env_set` | Auto-injected into every `shell` call; values never returned to conversation |
| Remove a persisted credential | `env_delete` | Pass the variable name |
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

## Skills

Skills are reusable task guides bundled with Backoffice. At the start of every conversation, run:

    bun /data/source/skills/scan.ts

This scans both `/data/source/skills/` (bundled defaults) and `/data/skills/` (user overrides). If both locations have a skill with the same name, `/data/skills/` wins. Read the relevant SKILL.md before starting any task it covers.

To add or edit a skill: create or modify a folder under `/data/source/skills/` (git-tracked) or `/data/skills/` (volume-only, private).
