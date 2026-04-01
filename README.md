# 🗼 Outpost

#### Give any AI assistant a remote shell to use any CLI without restrictions

## Why

AI assistants like [Claude](https://claude.ai/) can use MCPs to access external services, but the library of available MCPs is limited. If a service doesn't have an MCP, you're stuck searching for third-party providers.

This is what Outpost aims to solve. It allows Claude (or any other AI assistant app) to use the command line on a remote machine (through a `exec` tool it exposes) so that it can just use CLIs to access whatever services you usually access through the CLI, without the security restrictions Claude's own bash access has.

A simple example of this is [Strava](https://github.com/kvendrik/strava) access. Strava has no official MCP but I have a CLI for it that I use all the time. Instead of going to a 3rd party MCP provider I just use Outpost within Claude and tell it to install and use the Strava CLI within Outpost.

## Quick Start

> 🤖 Quickest setup is to ask your coding agent to read the [`AGENT.md`](/AGENT.md).
> `agent "Read this: https://kvendrik.com/outpost/AGENT.md"`

### 1. Clone

```bash
git clone git@github.com:kvendrik/outpost.git
```

### 2. Deploy to [Railway](https://railway.com/)

> Or any other remote machines service like [Fly.io](https://fly.io/). On Railway however this works out of the box — the server reads `RAILWAY_PUBLIC_DOMAIN` automatically. For other hosts, set `PUBLIC_BASE_URL` to your public origin.

```bash
brew install railway
railway login
railway up
```

### 3. Connect

#### `Claude.ai`

1. Go to **Settings → Connectors → Add custom connector**
2. Set the MCP URL to your deployed Railway app:`https://your-app.up.railway.app/mcp`

### 4. Use it

Start a new conversation on Claude.ai. Claude will now have access to a `exec` tool that executes commands on your remote machine.

## Authentication

Outpost comes with full OAuth. Apps like Claude.ai handle the entire flow automatically — no client ID or secret needs to be configured manually.

- **In-memory state.** Tokens are lost on restart, so they're naturally rotated on every deploy. Apps like Claude.ai re-authenticate automatically.
- **Short-lived tokens.** Access tokens expire every hour. Apps like Claude.ai refresh them automatically.

## Security

Outpost gives the AI unrestricted shell access on the machine it's deployed to. This is by design — it's what makes it flexible enough to use any CLI. Keep the following in mind:

- **Deploy on an isolated, ephemeral machine.** Services like Railway spin up fresh containers on every deploy. Treat the machine as disposable.
- **Don't store secrets on the machine.** Pass credentials through environment variables and use your hosting provider's secret management.
- **OAuth protects access.** Only clients that complete the OAuth flow can call the `exec` tool. There's no open endpoint.
