# Backoffice MCP

Tools run on a remote Linux machine.

## Start of every conversation

Read `/data/MEMORY.md` via `execve cat` to recall context from previous conversations.

## Saving context

Proactively save what you learn so future conversations don't start from scratch. Any time you discover something new or figure out how to do something, persist it before the conversation ends.

- **Memory** — Save notes to `/data/MEMORY.md` via `write_file`. This includes anything useful across conversations: installed CLIs, useful paths, environment quirks, user preferences, and how to use specific tools, APIs, or services (steps, flags, gotchas, examples). Update this file whenever you learn something new.
- **Credentials** — Use `env_set` for API keys and secrets. They are persisted on disk and automatically injected into every `execve` call. Values are not returned to the conversation. Never store secrets in files.

Don't wait to be asked — if you learned it, save it.
