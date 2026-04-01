# 🏤 Backoffice

Give any AI assistant with MCP support a backoffice that allows it to use CLI's, persist, and process data that it otherwise wouldn't be able to.

## Why

AI assistants like [Claude](https://claude.ai/) can use MCPs to access external services, but the library of available MCPs is limited. If a service doesn't have an MCP, you're stuck searching for third-party providers.

This is what Backoffice aims to solve. It allows Claude (or any other AI assistant app) to use the command line on a remote machine (through a `exec` tool it exposes) so that it can just use CLIs to access whatever services you usually access through the CLI, without the security restrictions Claude's own bash access has.

It also means it can do things like persist data on disk, run cron jobs, and do whatever other processing you might want to do on the data your AI assistant gives it.

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

Start a new conversation on Claude.ai. Claude will now have access to a `exec` tool that executes commands on your remote machine.

## Authentication

Backoffice comes with full OAuth. Apps like Claude.ai handle the entire flow automatically — no client ID or secret needs to be configured manually.

The OAuth consent screen requires a passphrase before issuing tokens. A passphrase is auto-generated on startup and printed to stdout. Set `AUTH_PASSPHRASE` to use your own.

- **In-memory state.** Tokens are lost on restart, so they're naturally rotated on every deploy. Apps like Claude.ai re-authenticate automatically.
- **Short-lived tokens.** Access tokens expire every hour. Apps like Claude.ai refresh them automatically.

## Persisting Data

By default Railway spins up a fresh container on every deploy. To persist data (installed CLIs, config files, etc.) add a [Volume](https://docs.railway.com/volumes) in your Railway service settings and mount it to a path like `/data`. Anything written there will survive deploys and restarts. See [Railway's Volumes docs](https://docs.railway.com/volumes) for details.

## Security

Backoffice gives the AI unrestricted shell access on the machine it's deployed to. This is by design — it's what makes it flexible enough to use any CLI. It does also mean that Backoffice is vulnerable in case the LLM does something you don't intend to do. Do keep this in mind.
