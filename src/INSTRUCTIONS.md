# Backoffice MCP

Tools run on a remote Linux machine.

## Start of every conversation

1. Read `/data/MEMORY.md` via `execve cat` to recall general context from previous conversations.
2. List `/data/skills/` via `execve ls` to see what per-tool knowledge is available, then read the relevant ones via `execve cat`.

## Saving context

- **Memory** — Save general notes (installed CLIs, useful paths, environment quirks) to `/data/MEMORY.md` via `write_file`.
- **Skills** — Save per-tool knowledge as markdown files in `/data/skills/` via `write_file` (e.g. `/data/skills/strava.md`).
- **Credentials** — Use `env_set` for API keys and secrets. They are persisted on disk and automatically injected into every `execve` call. Values are not returned to the conversation. Never store secrets in files.
