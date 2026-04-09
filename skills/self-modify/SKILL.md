---
name: self-modify
description: Make changes to Backoffice itself — adding tools, changing behaviour, fixing bugs, updating instructions, or modifying source code.
---

# Self-Modification Skill

Use this skill when asked to make changes to Backoffice itself — adding tools, changing behaviour, fixing bugs, updating instructions, etc.

## Source Location

The Backoffice source code lives at `/data/source/` (the `kvendrik/backoffice` public GitHub repo). Railway is configured to auto-deploy on every push to `main`.

## Project Structure

```
src/
  index.ts          # HTTP server, routing, session management
  mcp.ts            # MCP server factory, CORS helpers
  tools/
    index.ts        # Tool registration — add new tools here
    shell.ts        # The shell tool
    memory.ts       # memory_read/write/append/patch tools
    patch.ts        # patch_file tool
    env.ts          # env_set/env_delete tools
    instructions.ts # get_instructions tool
  INSTRUCTIONS.md   # System instructions returned by get_instructions
  oauth/            # OAuth flow
```

## How to Make Changes Effectively

### 1. Understand before editing
Always read the relevant file(s) before making changes:
```bash
cat /data/source/src/tools/index.ts
cat /data/source/src/index.ts
```

### 2. Make the change
Edit files directly in `/data/source/src/` using `patch_file` or shell commands.

### 3. Validate with TypeScript
Before pushing, check for type errors:
```bash
cd /data/source && bun tsc --noEmit 2>&1
```

### 4. Commit and push
```bash
cd /data/source
git add -A
git commit -m "Short description of change"
GIT_SSL_CAINFO=/data/cacert.pem git push
```
Railway will auto-deploy within ~30 seconds. No manual redeploy needed.

## Adding a New Tool

1. Create `src/tools/my-tool.ts` — export a function that returns `{ name, description, inputSchema, handler }`
2. Register it in `src/tools/index.ts`
3. If it needs system instruction documentation, update `src/INSTRUCTIONS.md`
4. Run `bun tsc --noEmit` to verify, then push

## Updating System Instructions

The instructions returned by `get_instructions` live in `src/INSTRUCTIONS.md`. Edit that file directly — no code changes needed.

## Key Constraints

- Runtime is **Bun**, not Node — use Bun APIs where relevant
- TypeScript strict mode is enabled — no `any` without good reason
- The container runs as `appuser` (limited permissions); `/data` is the writable volume
- No `/etc/ssl/` — always use `GIT_SSL_CAINFO=/data/cacert.pem` for git operations
