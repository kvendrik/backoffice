# 🏤 Backoffice

Backoffice gives your AI assistant — Claude.ai, ChatGPT, or any other — its own Linux machine that keeps working even when you're not in a conversation.

- Use any CLI — no MCPs needed.
- Run cron jobs — schedule tasks between conversations.
- Persist data — files, notes, and state survive across sessions.
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

1. Add `https://your-app.up.railway.app/mcp` as a MCP.
2. You'll be prompted for a passphrase which you can find in the startup logs. Backoffice logs it on startup.

### 4. Use it

Start a new conversation on Claude.ai. Claude will now have access to a set of tools that execute commands on your remote machine.

## Authentication

Backoffice comes with full OAuth. Apps like Claude.ai handle the entire flow automatically — no client ID or secret needs to be configured manually.

The OAuth consent screen requires a passphrase before issuing tokens. A passphrase is auto-generated on startup and printed to stdout. Set `AUTH_PASSPHRASE` to use your own.

- **In-memory state.** Tokens are lost on restart, so they're naturally rotated on every deploy. Apps like Claude.ai re-authenticate automatically.
- **Short-lived tokens.** Access tokens expire every hour. Apps like Claude.ai refresh them automatically.

## Persisting Data

By default Railway spins up a fresh container on every deploy. To persist data (installed CLIs, config files, etc.) add a [Volume](https://docs.railway.com/volumes) in your Railway service settings and mount it to a path like `/data`. Anything written there will survive deploys and restarts. See [Railway's Volumes docs](https://docs.railway.com/volumes) for details.

## Security

Backoffice gives the AI broad access to the machine it's deployed to. To reduce the risk of accidental damage, it applies a few guardrails:

- **No shell.** Commands run via `execve` (direct process execution), not `bash -c`. This eliminates shell injection and ensures every command is a structured program + argument list.
- **Dangerous command policy.** A blocklist prevents common mistakes: shell interpreters (which would bypass the execve design), privilege escalation (`sudo`), destructive disk operations (`dd`, `shred`), raw network tools (`nc`), and others. Some commands like `rm`, `git`, and `curl` are allowed but restricted to safe flag combinations.

These are **guardrails, not a sandbox.** They prevent the LLM from accidentally doing something destructive during normal use. They do not protect against a determined or compromised model — an LLM could still write a script to disk and execute it, for example. The real security boundary is the infrastructure: deploy on an isolated, ephemeral machine like Railway, so that the blast radius of anything unexpected is limited.
