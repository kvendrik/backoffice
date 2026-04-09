---
name: gh-check-mentions
description: Scan open PRs across Backoffice repos for comments containing "&backoffice" that need a reply or action. Run this when asked to check mentions, check PRs, or check if there's anything to respond to on GitHub.
---

# gh-check-mentions Skill

Scans all open PRs in the Backoffice repos for comments mentioning `&backoffice`, then summarises what needs a reply or action.

---

## Handle

The mention handle is `&backoffice` — not `@backoffice` (which would tag a real GitHub account).

---

## Repos to Check

| Repo | Purpose |
|---|---|
| `kvendrik/backoffice` | Source repo (public) |
| `kvendrik/backoffice-volume` | Volume repo (private) |

---

## How to Run

### 1. Fetch open PRs for each repo

```bash
GH="SSL_CERT_FILE=/data/cacert.pem GH_TOKEN=\"$GITHUB_TOKEN\" /data/gh"

# Get open PR numbers
eval "$GH api repos/kvendrik/backoffice/pulls --jq '.[].number'"
eval "$GH api repos/kvendrik/backoffice-volume/pulls --jq '.[].number'"
```

### 2. For each open PR, fetch all comment types

GitHub has three comment streams per PR — check all of them:

```bash
PR=2
REPO=kvendrik/backoffice

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

Only surface comments whose `body` contains the string `&backoffice` (case-insensitive). Skip empty bodies.

```bash
# Combined fetch + filter for one PR (issue comments example)
SSL_CERT_FILE=/data/cacert.pem GH_TOKEN="$GITHUB_TOKEN" /data/gh api \
  repos/kvendrik/backoffice/issues/2/comments \
  --jq '[.[] | select(.body | ascii_downcase | contains("&backoffice"))] | .[] | {user: .user.login, body, url: .html_url}'
```

---

## Output Format

After scanning, present a summary like:

```
=== Mention Check — kvendrik/backoffice ===

PR #2 — feat: add share CLI
  [issue comment] kvendrik  →  "...&backoffice can you double-check the token expiry logic?"
  URL: https://github.com/kvendrik/backoffice/pull/2#issuecomment-...

PR #3 — feat: bundle skills into source repo
  No mentions.

=== kvendrik/backoffice-volume ===
  No open PRs.
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
# Reply to an issue comment thread on a PR
SSL_CERT_FILE=/data/cacert.pem GH_TOKEN="$GITHUB_TOKEN" /data/gh api \
  repos/kvendrik/backoffice/issues/2/comments \
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
- PRs in `backoffice-volume` are rare but check anyway
