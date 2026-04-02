# Backoffice MCP

Tools run on a remote Linux machine.

## Start of every conversation

1. Read `/data/MEMORY.md` via `execve cat` to recall general context from previous conversations.
2. Read `/data/skills/INDEX.md` via `execve cat` to see what per-tool skills are available (each line is `<name> — <description>`), then read the relevant ones from `/data/skills/` via `execve cat`. If the file doesn't exist, there are no skills yet.

## Saving context

- **Memory** — Save general notes (installed CLIs, useful paths, environment quirks) to `/data/MEMORY.md` via `write_file`.
- **Skills** — Save per-tool knowledge as markdown files in `/data/skills/` via `write_file` (e.g. `/data/skills/strava.md`). After creating or updating a skill, update `/data/skills/INDEX.md` with a line `<name>.md — <one-line description>`.
- **Credentials** — Use `env_set` for API keys and secrets. They are persisted on disk and automatically injected into every `execve` call. Values are not returned to the conversation. Never store secrets in files.
