---
name: watch-comments
description: >
  Use this skill to watch a GitHub repo for new comments on issues and PRs.
  Triggers include: "watch for comments in X repo", "let me know when someone
  comments on PR #N", "keep an eye on issue #N", "start watching owner/repo",
  "notify me of new comments", or any request to monitor GitHub activity.
  Always use this skill — don't try to manually poll with gh commands.
---

# Watch Comments Skill

Polls GitHub for new comments on issues and PRs, printing them to stdout and
optionally sending Telegram notifications. State is persisted between runs so
the same comment is never reported twice.

---

## Quick Start

```bash
# Watch all open issues + PRs in a repo (runs forever, polls every 60s)
SSL_CERT_FILE=/data/cacert.pem GH_TOKEN="$GITHUB_TOKEN" \
  bun /app/skills/watch-comments/scripts/watch-comments.ts owner/repo

# Watch a specific PR
SSL_CERT_FILE=/data/cacert.pem GH_TOKEN="$GITHUB_TOKEN" \
  bun /app/skills/watch-comments/scripts/watch-comments.ts owner/repo --pr 42

# Watch a specific issue
SSL_CERT_FILE=/data/cacert.pem GH_TOKEN="$GITHUB_TOKEN" \
  bun /app/skills/watch-comments/scripts/watch-comments.ts owner/repo --issue 7

# Run one poll and exit (useful for testing / ad-hoc checks)
SSL_CERT_FILE=/data/cacert.pem GH_TOKEN="$GITHUB_TOKEN" \
  bun /app/skills/watch-comments/scripts/watch-comments.ts owner/repo --once

# Custom poll interval (e.g. every 2 minutes)
SSL_CERT_FILE=/data/cacert.pem GH_TOKEN="$GITHUB_TOKEN" \
  bun /app/skills/watch-comments/scripts/watch-comments.ts owner/repo --interval 120
```

---

## Running in the Background

To watch without blocking the session:

```bash
SSL_CERT_FILE=/data/cacert.pem GH_TOKEN="$GITHUB_TOKEN" \
  bun /app/skills/watch-comments/scripts/watch-comments.ts owner/repo \
  >> /data/skills/watch-comments/owner-repo.log 2>&1 &

echo "Watcher PID: $!"
```

Save the PID so you can stop it later:
```bash
echo $! > /data/skills/watch-comments/owner-repo.pid
```

---

## Checking on a Running Watcher

```bash
# Tail the log
tail -f /data/skills/watch-comments/owner-repo.log

# Check if it's still running
PID=$(cat /data/skills/watch-comments/owner-repo.pid)
kill -0 $PID 2>/dev/null && echo "running" || echo "not running"
```

## Stopping a Watcher

```bash
kill $(cat /data/skills/watch-comments/owner-repo.pid)
```

---

## Telegram Notifications

If `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set in the environment,
new comments are also sent as Telegram messages.

```bash
# Set once (persists to env)
export TELEGRAM_BOT_TOKEN=<token>
export TELEGRAM_CHAT_ID=<chat_id>
```

---

## What Gets Watched

For each open issue or PR, the script checks all three GitHub comment streams:

| Stream | API endpoint | Captured |
|---|---|---|
| Top-level thread | `issues/:n/comments` | Issue comments, PR conversation |
| Inline code comments | `pulls/:n/comments` | PR review line comments |
| Review submissions | `pulls/:n/reviews` | Submitted review bodies |

---

## State Files

Seen comment IDs are stored in:
```
/data/skills/watch-comments/state/<owner>-<repo>.json
```

To reset (re-report all existing comments on next run):
```bash
rm /data/skills/watch-comments/state/owner-repo.json
```

To use a custom state directory (e.g. for multiple watchers of the same repo):
```bash
bun watch-comments.ts owner/repo --state-dir /tmp/my-state
```

---

## Interpreting Output

Each new comment prints like:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📬 New comment on PR #42 in owner/repo
   "Fix the login bug"
   by @alice at 2025-01-15T14:32:00.000Z
   https://github.com/owner/repo/pull/42#issuecomment-123456

   Looks good to me, but could you add a test for the edge case?
```

---

## Options Reference

| Flag | Default | Description |
|---|---|---|
| `--interval <n>` | `60` | Poll interval in seconds |
| `--pr <n>` | — | Watch one PR only |
| `--issue <n>` | — | Watch one issue only |
| `--once` | — | Single poll, then exit |
| `--state-dir <path>` | `/data/skills/watch-comments/state` | Where to persist seen IDs |
