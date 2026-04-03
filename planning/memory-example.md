# Backoffice Memory

## Environment

- Runtime: Bun (not Node/npm)
- Working dir: `/app`
- OS: Linux (Debian-based, x86_64)

## MANDATORY STARTUP PROTOCOL

**Before any execve call, ALWAYS do these two steps first:**

1. Call `memory_read` — loads persisted state, CLI paths, credentials, syntax
2. Call `get_instructions` — loads full server tool docs

Never skip these. Never go straight to execve.

## Installed packages

- `@kvendrik/strava@0.1.0` installed at `/app/node_modules/@kvendrik/strava/`

## Strava CLI setup

- `STRAVA_CLIENT_ID` and `STRAVA_CLIENT_SECRET` are persisted via `env_set` (already set)
- Tokens stored at `/root/.strava-tokens.json` (default path)
- Token expires — always run `strava refresh` before any strava command

### Common commands

```
# Always refresh token first
bun run /app/node_modules/@kvendrik/strava/src/index.ts refresh

# List recent activities
bun run /app/node_modules/@kvendrik/strava/src/index.ts activities -n 5

# List as JSON
bun run /app/node_modules/@kvendrik/strava/src/index.ts activities --json -n 5

# Fetch single activity (full detail, JSON)
bun run /app/node_modules/@kvendrik/strava/src/index.ts activity <id>
```

### Re-install after restart

```
bun add @kvendrik/strava  # run in /app
```

### Auth flow (if tokens expire and refresh fails)

1. Generate OAuth URL: `https://www.strava.com/oauth/authorize?client_id=150190&redirect_uri=http://localhost:8080&response_type=code&scope=activity:read_all`
2. User visits URL, grabs `?code=` from redirect
3. Run: `bun run /app/node_modules/@kvendrik/strava/src/index.ts auth --code <code>`

## Key constraints

- No shell interpreters: `bash -c`, `sh -c`, `env`, `printenv` blocked by policy
- No curl — use bun scripts for HTTP
- No glob expansion in execve — use find/ls instead
- Bun binary: `/usr/local/bin/bun`

## User preferences

- Always use Strava via the backoffice when Koen asks about recent sessions, training data, or activity history
- Always call memory_read + get_instructions before any execve
