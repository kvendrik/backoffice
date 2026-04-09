# Git Skill

Use this skill for any git operations across the two repos.

## ⚠️ CRITICAL RULES

1. **ALWAYS ask permission before pushing** — never run `git push` without explicit approval from the user first
2. **NEVER modify `/data/source/` without asking first** — see source modification rule in MEMORY.md
3. Show a summary of what will be pushed and wait for a "yes" before running the push command

## Repos

| Repo | Path | Remote | Purpose |
|---|---|---|---|
| `backoffice-volume` (private) | `/data` | `https://kvendrik:${GITHUB_TOKEN}@github.com/kvendrik/backoffice-volume.git` | Persistent volume — scripts, skills, memory, cycling tools |
| `backoffice` (public) | `/data/source` | `https://kvendrik:${GITHUB_TOKEN}@github.com/kvendrik/backoffice.git` | Server source code — **ask before any changes** |

## Environment

- Always set `GIT_SSL_CAINFO=/data/cacert.pem` for any git network operation (push, pull, fetch, clone)
- Git user already configured in `/data/source` — for `/data` may need: `git config user.email "$(git -C /data/source config user.email)"`

### If `/data/cacert.pem` is missing

Check first:
```bash
ls /data/cacert.pem
```

If absent, download the Mozilla CA bundle (no SSL verification needed for this bootstrap step — it's a well-known public URL):
```bash
curl -k -o /data/cacert.pem https://curl.se/ca/cacert.pem
```

Verify it worked:
```bash
GIT_SSL_CAINFO=/data/cacert.pem git ls-remote https://github.com/kvendrik/backoffice.git HEAD
```

## Common Workflows

### Committing and pushing volume changes
```bash
cd /data
git add -A
git status        # review what's changing
git diff --staged # review diffs
git commit -m "descriptive message"
# ── ASK PERMISSION BEFORE THIS LINE ──
GIT_SSL_CAINFO=/data/cacert.pem git push
```

### Committing source changes (ask before ANY of this)
```bash
cd /data/source
git add -A
git status
git commit -m "descriptive message"
# ── ASK PERMISSION BEFORE THIS LINE ──
GIT_SSL_CAINFO=/data/cacert.pem git push
```

### Checking status
```bash
cd /data && git status
cd /data && git log --oneline -10
```

### Pulling latest
```bash
GIT_SSL_CAINFO=/data/cacert.pem git -C /data pull
GIT_SSL_CAINFO=/data/cacert.pem git -C /data/source pull
```

### Reverting a commit
```bash
cd /data/source && git revert <hash> --no-edit
# then ask before pushing
```

## Workflow Template

1. Make the changes
2. Run `git status` / `git diff --staged` — review what will change
3. Commit locally
4. Run `git status --short` and show the output to the user
5. **Ask**: "Ready to push to [repo] — shall I go ahead?"
6. Only push after a clear yes

**Always show the file list before asking to push. Example:**
```
Ready to push to backoffice-volume:

  M  planning/sharing.md
  M  skills/git/SKILL.md

Shall I go ahead?
```
