# Agent Guide

## What This Is

Backoffice is a remote MCP (Model Context Protocol) server that gives AI assistants like Claude command-line access on a remote machine via `shell`, `patch_file`, `env_set`, `env_delete`, `memory_read`, `memory_write`, `memory_append`, `memory_patch`, and `get_instructions` tools. Instead of relying on individual MCPs for every service, the AI can just use existing CLIs through Backoffice. It can also persist data on disk, run cron jobs, and do whatever other processing you might want to do on the data your AI assistant gives it.

It's designed to be deployed on an isolated, ephemeral machine (e.g. Railway). Clients connect over HTTP at `/mcp`, authenticate via OAuth (or a static bearer token), and can then run bash commands on the host.

## How It Works

1. An MCP client (e.g. Claude.ai) connects to `/mcp` and authenticates
2. The server registers MCP tools: `shell`, `patch_file`, `env_set`, `env_delete`, `memory_read`, `memory_write`, `memory_append`, `memory_patch`, and `get_instructions`
3. `shell` runs a bash command and returns stdout, stderr, and the exit code. Working directory and environment persist across calls. `patch_file` applies structured line patches to files. `env_set`/`env_delete` persist environment variables (credentials, API keys) that are automatically injected into every `shell` call. `memory_read`/`memory_write`/`memory_append`/`memory_patch` give the AI persistent memory across conversations (`/data/MEMORY.md`). `get_instructions` returns the full system instructions for the MCP server.
4. OAuth state is in-memory only — tokens are lost on restart/redeploy

## Setup for the User

When a user asks you to set up Backoffice, follow these steps:

### 1. Install dependencies

```bash
bun install
```

### 2. Install the Railway CLI and deploy

```bash
brew install railway
```

Then tell the user to run `railway login` — this opens a browser and requires human interaction. Once logged in, deploy:

```bash
railway up
```

Railway auto-sets `RAILWAY_PUBLIC_DOMAIN`. For other hosts (Fly.io, etc.), the user needs to set `PUBLIC_BASE_URL` to their public origin.

### 3. Connect to Claude.ai

Tell the user to go to **Claude.ai → Settings → Connectors → Add custom connector** and set the MCP URL to `https://<their-railway-domain>.up.railway.app/mcp`. This is a manual UI step.

### 4. Persist data (optional)

By default Railway spins up a fresh container on every deploy. To persist data (installed CLIs, config files, etc.) tell the user to add a [Volume](https://docs.railway.com/volumes) in their Railway service settings and mount it at `/data`. This path is required — the AI is instructed to use `/data` for memory and credentials.

## Tech Stack

- **Runtime**: [Bun](https://bun.sh/)
- **Language**: TypeScript (strict mode)
- **Framework**: None — plain `Bun.serve()` HTTP server
- **Key dependency**: `@modelcontextprotocol/sdk` for MCP protocol + OAuth

## Project Structure

```
src/
  index.ts          # Entry point — HTTP server, routing, session management
  mcp.ts            # MCP server factory, CORS helpers
  INSTRUCTIONS.md   # MCP instructions sent to the AI on connect
  tools/            # MCP tool modules (exec, fs, patch, env, memory, instructions)
  oauth/
    index.ts        # Re-exports
    runtime.ts      # OAuth endpoint handlers (authorize, token, register)
    memoryProvider.ts  # In-memory OAuth client/token store
    fileProvider.ts    # File-backed OAuth store (used when OAUTH_STATE_FILE is set)
    eventStore.ts   # In-memory SSE event store for resumable streams
```

## Commands

```bash
bun install          # Install dependencies
bun run start        # Start the server (default: port 3000)
bun run typecheck    # Type-check without emitting
bun run lint         # Lint with ESLint
bun run lint:fix     # Lint and auto-fix
bun run format       # Format with Prettier
bun run format:check # Check formatting
```

## Environment Variables

| Variable                | Required | Description                                                                                                   |
| ----------------------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| `PORT`                  | No       | Server port (default: `3000`)                                                                                 |
| `PUBLIC_BASE_URL`       | No       | Public origin for OAuth metadata. Set when not on Railway.                                                    |
| `RAILWAY_PUBLIC_DOMAIN` | No       | Auto-set by Railway. Used as public origin if `PUBLIC_BASE_URL` is unset.                                     |
| `AUTH_PASSPHRASE`       | No       | Passphrase required on the OAuth authorize screen. Auto-generated on startup if not set. Printed to stdout.   |
| `USE_MCP_TOKEN_AUTH`    | No       | Set to `1` to use static bearer token auth instead of OAuth. Useful for local dev or non-browser MCP clients. |
| `MCP_TOKEN`             | No       | Static bearer token (only used when `USE_MCP_TOKEN_AUTH=1`). Auto-generated to `.mcp-token` if unset.         |
| `ALLOWED_REDIRECT_URI_DOMAINS` | No | Comma-separated list of domains OAuth clients are allowed to register redirect URIs for. Default: `claude.ai`. Set to `claude.ai,localhost` to also allow local clients. |

## Local Development

```bash
bun install
USE_MCP_TOKEN_AUTH=1 bun run start
```

The server prints the bearer token to stdout. Use it as `Authorization: Bearer <token>` against `http://localhost:3000/mcp`.

## Code Conventions

- No unnecessary comments — code should be self-explanatory
- Explicit `undefined`/`null` checks instead of loose truthiness
- Use `node:` prefix for Node built-ins (`node:crypto`, `node:fs`)
- Zod for all runtime input validation
- OAuth state is persisted to `/data/oauth-state.json` by default; set `OAUTH_RESET_ON_RESTART=1` for in-memory only
