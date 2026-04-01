# Agent Guide

## What This Is

Outpost is a remote MCP (Model Context Protocol) server that gives AI assistants like Claude unrestricted shell access on a remote machine via an `exec` tool. Instead of relying on individual MCPs for every service, the AI can just use existing CLIs through Outpost.

It's designed to be deployed on an isolated, ephemeral machine (e.g. Railway). Clients connect over HTTP at `/mcp`, authenticate via OAuth (or a static bearer token), and can then run arbitrary bash commands on the host.

## How It Works

1. An MCP client (e.g. Claude.ai) connects to `/mcp` and authenticates
2. The server creates an MCP session with a single tool: `exec`
3. `exec` runs the given string through `/bin/bash -c` and returns stdout, stderr, and the exit code
4. OAuth is fully in-memory — tokens rotate on every deploy, no database needed

## Setup for the User

When a user asks you to set up Outpost, follow these steps:

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
  tools.ts          # MCP tool definitions (exec)
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
