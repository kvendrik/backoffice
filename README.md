# 🏤 Backoffice

Backoffice gives your AI assistant — Claude.ai, ChatGPT, or any other — its own Linux machine that keeps working even when you're not in a conversation.

- Use any CLI — no MCPs needed.
- Run cron jobs — schedule tasks between conversations.
- Persist data — files, memory, and state survive across sessions.
- Store credentials securely — API keys live on the machine, not in the chat.

## Why

AI assistants like Claude and ChatGPT can use MCPs to access external services, but the library of available MCPs is limited. If a service doesn't have an MCP, you're stuck searching for third-party providers.

This is what Backoffice aims to solve. It gives Claude, ChatGPT, or any other AI assistant app, a remote Linux machine so that it has a command line it can use without any restrictions.

> A simple example of something Backoffice has been useful for is [Strava](https://github.com/kvendrik/strava) access. Strava has no official MCP but I have a CLI for it that I use all the time. Instead of going to a 3rd party MCP provider I just use Backoffice within Claude and tell it to install and use the Strava CLI within Backoffice.

## Quick Start

> 🤖 Quickest setup is to ask your coding agent to read the [`AGENT.md`](/AGENT.md):
>
> ```
> agent "Read this: https://kvendrik.com/backoffice/AGENT.md"
> ```

### 1. Clone

```bash
git clone git@github.com:kvendrik/backoffice.git
```

### 2. Deploy to [Railway](https://railway.com/)

> Or any other remote machines service like [Fly.io](https://fly.io/). On Railway however this works out of the box — the server reads `RAILWAY_PUBLIC_DOMAIN` automatically. For other hosts, set `PUBLIC_BASE_URL` to your public origin.

```bash
brew install railway
railway login
railway up
```

### 3. Connect

1. Add `https://your-app.up.railway.app/mcp` as an MCP.
2. You'll be prompted for a passphrase which you can find in the startup logs. Backoffice logs it on startup.

### 4. Use it

Start a new conversation with your assistant. It will now have access to the remote machine through the Backoffice MCP.

## Authentication

Backoffice comes with full OAuth. Apps like Claude.ai handle the entire flow automatically — no client ID or secret needs to be configured manually.

The OAuth consent screen requires a passphrase before issuing tokens. A passphrase is auto-generated on startup and printed to stdout. Set `AUTH_PASSPHRASE` to use your own.

- **In-memory state.** Tokens are lost on restart, so they're naturally rotated on every deploy. Apps like Claude.ai re-authenticate automatically.
- **Short-lived tokens.** Access tokens expire every hour. Apps like Claude.ai refresh them automatically.

## Tools

Backoffice exposes the following tools:

| Tool              | Purpose                                                                                                                                                                                                                                                                                                                             |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `execve`          | Run any program directly (no shell). Working directory and environment persist across calls. This is the primary tool — it gives the AI access to every CLI on the machine. Output is capped at 1 MB per stream by default (configurable via `max_output_bytes`). Persistent env vars set via `env_set` are automatically injected. |
| `execve_pipeline` | Pipe multiple programs together (`grep` into `wc`, etc.) using the same execve semantics. Needed because there's no shell to write `\|` in. Same output cap as `execve`.                                                                                                                                                            |
| `write_file`      | Write text to a file, creating parent directories as needed. Exists as a dedicated tool because shell redirects and piping to stdin are unavailable in `execve`.                                                                                                                                                                    |
| `patch_file`      | Apply a structured line-based patch to a file. Safer than a full overwrite for small edits to large files.                                                                                                                                                                                                                          |
| `env_set`         | Persist an environment variable. Stored on disk and automatically injected into every `execve`/`execve_pipeline` call. Use for credentials and API keys — values are not returned to the conversation.                                                                                                                              |
| `env_delete`      | Remove a persisted environment variable.                                                                                                                                                                                                                                                                                            |

The AI is also instructed to use the filesystem for memory and skills:

- **`/data/MEMORY.md`** — General notes that persist across conversations (installed CLIs, useful paths, environment quirks). Read at the start of every conversation via `execve cat`, written via `write_file`.
- **`/data/skills/<name>.md`** — Per-tool knowledge (e.g. how to use a specific CLI). Listed via `execve ls`, read via `execve cat`, written via `write_file`.

## Security

`execve`, `execve_pipeline`, and `write_file` together basically replace an `exec` tool with full shell access. The reason we do this is to create more control over what commands the LLM is trying to execute.

`execve` requires the LLM to call a single command + arguments at a time which allows us to analyze what it's trying to do a lot better than if we would allow shell redirects and pipes. When it tries to run a command we:

1. **Run it through the [policy system](/src/tools/policy/index.ts)**, which analyzes what goes in and comes out of a tool call.
2. **[Resolve the binary](/src/tools/policy/exec/index.ts)**. For `execve` we first resolve the binary. This is so that we know what command the LLM is _really_ trying to run (resolves symlinks and aliases to their actual binaries).
3. **Check for [dangerous commands](/src/tools/policy/exec/dangerous.ts)**. We check if the command the LLM is trying to run is potentially dangerous.
4. **[Filter dangerous `rm` calls](/src/tools/policy/exec/index.ts)**. `rm -r` is allowed, but blocked when any target is `/` or a direct child of `/` (e.g. `/usr`, `/data`). Deeper paths like `/data/old-project` are fine.
5. **[Filter direct env reads](/src/tools/policy/exec/index.ts)**. Direct reads and writes of the env secrets file and `printenv`/`env` commands are blocked to prevent persisted credentials from leaking back into the conversation (_the LLM could however still write a script that reads the env and run it_).

Doing this is best practise and it’s a pretty good system to prevent the LLM from accidentally doing something destructive during normal use. **Please do note that this does not protect against a determined or compromised model** — an LLM could still write a script to disk and execute it, for example. The real security boundary is the infrastructure: **deploy on an isolated, ephemeral machine like Railway, so that the blast radius of anything unexpected is limited.**

## Persisting Data

By default Railway spins up a fresh container on every deploy. To persist data add a [Volume](https://docs.railway.com/volumes) in your Railway service settings and mount it at `/data`. The AI is instructed to use `/data` for memory, skills, and credentials (via `env_set`), so this path matters. See [Railway's Volumes docs](https://docs.railway.com/volumes) for details.

To persist installed CLIs etc between deploys, add them to the [Dockerfile](/Dockerfile).
