---
name: cron
description: >
  Schedule recurring commands using a Bun-native cron scheduler.
  Use when the user wants to run something on a schedule (e.g. "remind me every
  morning", "check for new comments every 30 minutes", "run my FTP trend script
  daily"). Manages /data/cron.json which is read every 60s, so edits are
  picked up without restart.
---

# Cron Skill

A lightweight in-process cron scheduler (powered by croner) built into the
Backoffice server. It reads `/data/cron.json` every 60 seconds and runs
matching commands. Changes are picked up automatically — no restart needed.

## Managing Jobs

All management goes through the helper script which validates input and gives
clear error messages:

```bash
# List all jobs (shows index, schedule, next run)
bun /app/skills/cron/scripts/manage.ts list

# Add a job (validates the cron expression before saving)
bun /app/skills/cron/scripts/manage.ts add "0 9 * * *" "echo good morning"

# Remove a job by index (run list first to see indices)
bun /app/skills/cron/scripts/manage.ts remove 0
```

Jobs are picked up automatically within 60 seconds of any change.

## Cron Syntax

Standard 5-field: `minute hour day-of-month month day-of-week`

| Expression | Meaning |
|---|---|
| `* * * * *` | Every minute |
| `0 9 * * *` | Daily at 09:00 UTC |
| `*/15 * * * *` | Every 15 minutes |
| `0 9 * * 1-5` | Weekdays at 09:00 UTC |
| `0 0 1 * *` | First of every month |

## Notes

- Scheduler starts automatically with the server
- Config is re-read every 60s — no restart needed for changes
- `protect: true` prevents overlapping runs of the same job
- Jobs run via `sh -c`, so pipes and env vars work
- Logs go to stdout: `[cron] Running: <command>`
- `/data/cron.json` lives on the persistent volume — survives restarts
- Time zone is UTC (container default)
