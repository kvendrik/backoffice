# 🏤 Backoffice

Backoffice gives your AI assistant — Claude.ai, ChatGPT, or any other — its own Linux machine that keeps working even when you're not in a conversation.

- Use any CLI — no MCPs needed.
- Run cron jobs — schedule tasks between conversations.
- Persist data — files, memory, and state survive across sessions.
- Store credentials securely — API keys live on the machine, not in the chat.

## Why

AI assistants like Claude and ChatGPT can use MCPs to access external services, but the library of available MCPs is limited. If a service doesn't have an MCP, you're stuck searching for third-party providers.

This is what Backoffice aims to solve. It gives Claude, ChatGPT, or any other AI assistant app, a remote Linux machine so that it has a command line it can use with minimal restrictions.

> A simple example of something Backoffice has been useful for is [Strava](https://github.com/kvendrik/strava) access. Strava has no official MCP but I have a CLI for it that I use all the time. Instead of going to a 3rd party MCP provider I just use Backoffice within Claude and tell it to install and use the Strava CLI within Backoffice.

## Quick Start

First:

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/me5Zii?referralCode=Du7Dll&utm_medium=integration&utm_source=template&utm_campaign=generic)

Then:

1. Add `https://your-app.up.railway.app/mcp` as an MCP at your favorite AI assistant.
2. Your assistant will prompt you for a password, this in a random string that can be found in the Railway service logs.
3. Start a new conversation with your assistant. It will now have access to the remote machine through the Backoffice MCP.

The [one-click install](https://railway.com/deploy/me5Zii?referralCode=Du7Dll&utm_medium=integration&utm_source=template&utm_campaign=generic) sets up this repo as a Railway app, will mount a volume on `/data` to persist data (see "Persisting Data" below), and sets up a health check for `GET /version` so that Railway monitors the health of the service using that endpoint.

## Manual Setup

### 🤖 Option 1: Ask your coding agent

```bash
claude "Read this: https://kvendrik.com/backoffice/AGENT.md"
```

### 🙋‍♂️🙋‍♀️ Option 2: DIY

#### 1. Clone

```bash
git clone git@github.com:kvendrik/backoffice.git
```

#### 2. Deploy to [Railway](https://railway.com/)

> Or any other remote-machines service like [Fly.io](https://fly.io/). On Railway however this works out of the box — the server reads `RAILWAY_PUBLIC_DOMAIN` automatically. For other hosts, set `PUBLIC_BASE_URL` to your public origin.

```bash
brew install railway
railway login
railway up
```

#### 3. Connect

1. Add `https://your-app.up.railway.app/mcp` as an MCP.
2. You'll be prompted for a passphrase which you can find in the startup logs. Backoffice logs it on startup.

#### 4. Use it

Start a new conversation with your assistant. It will now have access to the remote machine through the Backoffice MCP.

## Authentication

Backoffice comes with full OAuth. Apps like Claude.ai handle the entire flow automatically — no client ID or secret needs to be configured manually.

The OAuth consent screen requires a passphrase before issuing tokens. A passphrase is auto-generated on startup and printed to stdout. Set `AUTH_PASSPHRASE` to use your own.

- **Persistent state (default).** Tokens are saved to `/data/oauth-state.json` and survive restarts and redeploys. Requires a `/data` Volume — see "Persisting Data" below. Set `OAUTH_RESET_ON_RESTART=1` to disable.
- **In-memory state.** Set `OAUTH_RESET_ON_RESTART=1` to use in-memory state instead. Tokens are lost on restart and apps like Claude.ai re-authenticate automatically.
- **Short-lived tokens.** Access tokens expire every hour. Apps like Claude.ai refresh them automatically.

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `AUTH_PASSPHRASE` | *(random, logged on startup)* | Passphrase required on the OAuth consent screen. Set this to a strong secret so it never appears in logs. |
| `ALLOWED_REDIRECT_URI_DOMAINS` | `claude.ai` | Comma-separated list of domains that OAuth clients are allowed to register redirect URIs for. Registrations with a `redirect_uri` on a domain not in this list are rejected. Set to `claude.ai,localhost` to also allow local clients. |
| `OAUTH_RESET_ON_RESTART` | `false` | Set to `1` to disable OAuth state persistence. Existing tokens are lost on restart and clients re-authenticate automatically. |
| `USE_MCP_TOKEN_AUTH` | `false` | Set to `1` to replace OAuth with a single static bearer token. Simpler, but no per-client visibility in logs. The token is read from `MCP_TOKEN` or auto-generated and written to `.mcp-token`. |
| `MCP_TOKEN` | *(auto-generated)* | Static bearer token. Only used when `USE_MCP_TOKEN_AUTH=1`. |
| `PUBLIC_BASE_URL` | *(derived from `RAILWAY_PUBLIC_DOMAIN`)* | Public origin of the server (e.g. `https://your-app.up.railway.app`). Required on non-Railway hosts. |
| `PORT` | `3000` | Port the server listens on. |

## Tools

| Tool               | Purpose                                                                                                                                                                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shell`            | Run any bash command on the machine. Working directory and environment persist across calls. Output is capped at 1 MB per stream by default (configurable via `max_output_bytes`). Credentials set via `env_set` are automatically injected. |
| `patch_file`       | Apply a structured line-based patch to a file. Useful for targeted edits to specific lines in large files without rewriting the whole thing.                                                                                                 |
| `env_set`          | Persist an environment variable. Stored on disk and automatically injected into every `shell` call. Use for credentials and API keys — values are not returned to the conversation.                                                          |
| `env_delete`       | Remove a persisted environment variable.                                                                                                                                                                                                     |
| `memory_read`      | Read the persistent memory file (`/data/MEMORY.md`). Called at the start of every conversation to recall context from previous sessions.                                                                                                     |
| `memory_write`     | Write to the persistent memory file. The AI proactively saves anything useful across conversations: installed CLIs, useful paths, environment quirks, user preferences, and how to use specific tools/APIs/services.                         |
| `memory_append`    | Append content to the memory file. The simplest way to add new information — no format overhead, no context-mismatch risk.                                                                                                                   |
| `memory_patch`     | Apply a targeted patch to the memory file using the same `*** Begin Patch` format as `patch_file`. Use for surgical replacements of known stale content.                                                                                     |
| `get_instructions` | Return the full system instructions for the MCP server. The AI can call this if it needs guidance on conventions or tool usage.                                                                                                              |

## Security

The server runs as a non-root user (`appuser`). This means the OS itself enforces what the process can and can't touch.

**What's protected:**

- System directories (`/usr`, `/bin`, `/etc`, etc.) — root-owned, unwritable
- App source (`/app`) — root-owned, unwritable

**What's writable:**

- `/data` — persistent volume, owned by `appuser`
- `/tmp` — ephemeral scratch space

## Persisting Data

By default Railway spins up a fresh container on every deploy. To persist data add a [Volume](https://docs.railway.com/volumes) in your Railway service settings and mount it at `/data`. The AI is instructed to use `/data` for memory and credentials (via `env_set`), so this path matters. See [Railway's Volumes docs](https://docs.railway.com/volumes) for details.

Packages installed via `bun install -g` go to `/data/bun` and packages installed via `brew install` go to `/data/homebrew` — both paths are on the persistent volume, so installed tools survive redeploys automatically.

## Logs

Backoffice keeps logs of all tool calls (includes caller oauth details) and results in `/data/log.jsonl`. Analyzing this file can help you figure out how to improve your setup:

```bash
claude "Here are the logs from the Backoffice railway server and show how the AI assistant has been using Backoffice. Tell me what you notice.\n\n---\n\n$(railway ssh -- cat /data/log.jsonl)"
```
