# Agent Guide

## What This Is

Backoffice is a remote MCP (Model Context Protocol) server that gives AI assistants like Claude command-line access on a remote machine via `execve`, `execve_pipeline`, `write_file`, and `patch_file` tools. Instead of relying on individual MCPs for every service, the AI can just use existing CLIs through Backoffice. It can also persist data on disk, run cron jobs, and do whatever other processing you might want to do on the data your AI assistant gives it.

It's designed to be deployed on an isolated, ephemeral machine (e.g. Railway). Clients connect over HTTP at `/mcp`, authenticate via OAuth (or a static bearer token), and can then run programs on the host. Commands run via `execve` (no shell) with a policy that blocks accidentally destructive operations.

## How It Works

1. An MCP client (e.g. Claude.ai) connects to `/mcp` and authenticates
2. The server registers MCP tools: `execve`, `execve_pipeline`, `write_file`, and `patch_file`
3. `execve` runs a program directly (no shell) with an argument vector and returns stdout, stderr, and the exit code. `execve_pipeline` does the same but pipes stdout of each stage into stdin of the next. Most filesystem work uses `execve` (e.g. `cat`, `ls`, `mv`, `rm`). `write_file` covers creating and overwriting text without a shell; `patch_file` applies structured line patches.
4. OAuth is fully in-memory — tokens rotate on every deploy, no database needed

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

By default Railway spins up a fresh container on every deploy. To persist data (installed CLIs, config files, etc.) tell the user to add a [Volume](https://docs.railway.com/volumes) in their Railway service settings and mount it to a path like `/data`.

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
  tools/            # MCP tool modules (exec, fs, patch)
  oauth/
    index.ts        # Re-exports
    runtime.ts      # OAuth endpoint handlers (authorize, token, register)
    memoryProvider.ts  # In-memory OAuth client/token store
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
- All OAuth state is in-memory (no database)
