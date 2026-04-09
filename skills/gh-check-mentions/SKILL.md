---
name: gh-check-mentions
description: Scan open PRs in a GitHub repo for comments containing "&backoffice" that need a reply or action. Run this when asked to check mentions, check PRs, or check if there's anything to respond to on GitHub.
---

# gh-check-mentions Skill

Scans all open PRs in a given repo for comments mentioning `&backoffice`, then summarises what needs a reply or action.

---

## Handle

The mention handle is `&backoffice` — not `@backoffice` (which would tag a real GitHub account).

---

## How to Run

The user will tell you which repo(s) to scan. Use `OWNER/REPO` format throughout.

### 1. Fetch open PR numbers

```bash
SSL_CERT_FILE=/data/cacert.pem GH_TOKEN="$GITHUB_TOKEN" /data/gh api \
  repos/OWNER/REPO/pulls --jq '.[].number'
```

### 2. For each open PR, fetch all comment types

GitHub has three comment streams per PR — check all of them:

```bash
PR=2
REPO=OWNER/REPO

# (a) Issue comments — top-level conversation thread
SSL_CERT_FILE=/data/cacert.pem GH_TOKEN="$GITHUB_TOKEN" /data/gh api \
  repos/$REPO/issues/$PR/comments --jq '.[] | {id, user: .user.login, body, url: .html_url}'

# (b) Review comments — inline code comments
SSL_CERT_FILE=/data/cacert.pem GH_TOKEN="$GITHUB_TOKEN" /data/gh api \
  repos/$REPO/pulls/$PR/comments --jq '.[] | {id, user: .user.login, body, url: .html_url}'

# (c) Reviews — overall review submissions (approved, changes requested, comments)
SSL_CERT_FILE=/data/cacert.pem GH_TOKEN="$GITHUB_TOKEN" /data/gh api \
  repos/$REPO/pulls/$PR/reviews --jq '.[] | {id, user: .user.login, body, state, url: .html_url}'
```

### 3. Filter for `&backoffice`

Only surface comments whose `body` contains `&backoffice` (case-insensitive). Skip empty bodies.

```bash
SSL_CERT_FILE=/data/cacert.pem GH_TOKEN="$GITHUB_TOKEN" /data/gh api \
  repos/$REPO/issues/$PR/comments \
  --jq '[.[] | select(.body | ascii_downcase | contains("&backoffice"))] | .[] | {user: .user.login, body, url: .html_url}'
```

---

## Output Format

After scanning, present a summary like:

```
=== Mention Check — OWNER/REPO ===

PR #2 — feat: add share CLI
  [issue comment] kvendrik  →  "...&backoffice can you double-check the token expiry logic?"
  URL: https://github.com/OWNER/REPO/pull/2#issuecomment-...

PR #3 — feat: bundle skills into source repo
  No mentions.
```

---

## Determining What Needs Action

For each mention, read the full comment and classify it:

| Type | Example | Action |
|---|---|---|
| Question | "can you explain..." | Draft a reply |
| Code review request | "can you look at..." | Read the diff, reply with assessment |
| Task / change request | "can you update..." | Make the change, reply when done |
| FYI / no action | "just so &backoffice knows..." | Acknowledge, no action needed |
| Already replied | Earlier &backoffice response in thread | Skip |

Always read the surrounding thread context before deciding — a mention may already have been addressed in a follow-up comment.

---

## Replying to a Comment

```bash
SSL_CERT_FILE=/data/cacert.pem GH_TOKEN="$GITHUB_TOKEN" /data/gh api \
  repos/$REPO/issues/$PR/comments \
  --method POST \
  --field body='Your reply here' \
  --jq '.html_url'
```

**Before posting any reply, always show the draft to Koen and wait for approval.**

---

## Gotchas

- `gh pr view --comments` only shows issue comments — use the three-endpoint approach above to catch inline review comments too
- Reviews with an empty `body` are normal (e.g. a bare "Approved") — skip them when filtering
- The `&backoffice` string may appear mid-sentence; match the full comment body, not just word boundaries
- Always read surrounding thread context before acting — don't reply to something already addressed
