---
name: share
description: Share files with the user via a short-lived tokenized download link. Use this skill whenever you've created a file (report, image, PDF, ZIP, etc.) and need to hand it to the user. Always ask the user before sharing anything.
---

# Share Skill

Use this to hand files to the user via a temporary download link. The share server runs locally on port 3001 and registers `/share` with the MCP server so links are served via the main Railway domain.

---

## ⚠️ Always Ask First

**Never share a file without asking the user first.** Even if you just generated it. Example:

> "I've created `report.pdf` — want me to share a download link?"

Wait for a yes before running any share commands.

---

## Setup (once per session)

The server must be running before any file can be shared. Check first:

```bash
curl -s http://localhost:3001/health
```

If it returns `ok`, the server is already up. If it fails, start it:

```bash
# Start the share server (background — does not block the session)
bun /app/skills/share server
```

Use `shell(background: true, ...)` for this call. The server prunes expired tokens at startup and every 60 seconds.

---

## Sharing a File

```bash
bun /app/skills/share add <path> [flags]
```

| Flag | Default | Description |
|---|---|---|
| `--minutes <n>` | `10` | Link lifetime (max 60) |
| `--times <n>` | `1` | Max downloads before expiry |
| `--delete-after` | off | Delete source file after final download |
| `--max-size <bytes>` | 100MB | Reject if file exceeds this size |

**File must be under `/data/`, `/tmp/`, or `/var/tmp/`.** Move it there first if needed.

### Example

```bash
# Move generated file into a safe location and share it
cp /home/claude/report.pdf /tmp/report.pdf
bun /app/skills/share add /tmp/report.pdf --minutes 15
```

Output:

```
  https://<domain>/share/<token>

  ⏱  15 min · 1 download
  📄 /tmp/report.pdf
```

Give the URL to the user.

---

## Managing Links

```bash
# See all active links with time and uses remaining
bun /app/skills/share list

# Revoke by token prefix
bun /app/skills/share rm a3f8c1

# Revoke by file path
bun /app/skills/share rm /tmp/report.pdf
```

---

## Help

```bash
bun /app/skills/share -h
```

---

## Gotchas

- `share add` checks that the server is running before registering — if it fails, start the server first
- Links expire by time OR download count, whichever comes first
- `--delete-after` only triggers on the final counted download; time-based expiry does NOT delete the file
- The public URL is derived from `RAILWAY_PUBLIC_DOMAIN` (set automatically by Railway) — if unset, URLs show `http://localhost:3001`
- Files outside `/data/`, `/tmp/`, `/var/tmp/` are rejected — always move them first
