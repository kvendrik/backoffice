---
name: gh-comments
description: >
  Use this skill to fetch or watch GitHub comments on issues and PRs.
  Triggers include: "get comments in X repo", "watch for comments in X repo",
  "any new comments on PR #N?", "keep an eye on issue #N", "start watching
  owner/repo", "notify me of new comments". Default mode fetches once and exits;
  use --watch to poll continuously.
---

# gh-comments Skill

Fetch new comments once, or watch continuously. State is persisted between runs
so the same comment is never reported twice.

---

## Prerequisites

- **`/data/bins/gh`** — GitHub CLI must be installed. If missing, see the github skill for install instructions.
- **`/data/cacert.pem`** — CA bundle for SSL. If missing, see the git skill for the bootstrap command.
- **`GITHUB_TOKEN`** — Personal access token. If missing, see the github skill Auth section.

---

## Usage

```bash
# Fetch new comments once and exit (default)
bun gh-comments.ts <owner/repo>

# Watch continuously, polling every 60s
bun gh-comments.ts <owner/repo> --watch

# Scope to a specific PR or issue
bun gh-comments.ts <owner/repo> --pr 42
bun gh-comments.ts <owner/repo> --issue 7

# Custom poll interval (watch mode only)
bun gh-comments.ts <owner/repo> --watch --interval 120

# Show all comments, ignoring state (re-fetch everything seen so far)
bun gh-comments.ts <owner/repo> --all
```

Always set env vars:
```bash
SSL_CERT_FILE=/data/cacert.pem GH_TOKEN="$GITHUB_TOKEN" bun gh-comments.ts ...
```

---

## Running in the Background (watch mode)

```bash
SSL_CERT_FILE=/data/cacert.pem GH_TOKEN="$GITHUB_TOKEN" \
  bun /app/skills/gh-comments/scripts/gh-comments.ts <owner/repo> --watch \
  >> /tmp/gh-comments/<owner>-<repo>.log 2>&1 &

echo $! > /tmp/gh-comments/<owner>-<repo>.pid
echo "Watcher started"
```

Check on it:
```bash
tail -f /tmp/gh-comments/<owner>-<repo>.log
kill -0 $(cat /tmp/gh-comments/<owner>-<repo>.pid) && echo running || echo stopped
```

Stop it:
```bash
kill $(cat /tmp/gh-comments/<owner>-<repo>.pid)
```

---

## Telegram Notifications

Set once; persists to env:
```bash
export TELEGRAM_BOT_TOKEN=<token>
export TELEGRAM_CHAT_ID=<chat_id>
```

When set, every new comment is also sent as a Telegram message.

---

## What Gets Checked

For each open issue or PR, all three GitHub comment streams are checked:

| Stream | Covers |
|---|---|
| `issues/:n/comments` | Top-level thread (issues + PR conversation) |
| `pulls/:n/comments` | Inline review comments |
| `pulls/:n/reviews` | Submitted review bodies |

---

## State Files

Seen comment IDs are stored per-repo at:
```
/tmp/gh-comments-state/<owner>-<repo>.json
```

Reset (re-report all existing comments on next run):
```bash
rm /tmp/gh-comments-state/<owner>-<repo>.json
```

Or use `--all` for a one-off full fetch without touching the state file.

---

## Options

| Flag | Default | Description |
|---|---|---|
| `--watch` | — | Poll continuously instead of fetching once |
| `--pr <n>` | — | Scope to one PR |
| `--issue <n>` | — | Scope to one issue |
| `--interval <n>` | `60` | Seconds between polls (watch mode only) |
| `--all` | — | Ignore state; show all comments |
| `--state-dir <path>` | `/tmp/gh-comments-state` | Custom state location |
