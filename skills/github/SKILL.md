---
name: github
description: How to install and use the GitHub CLI (gh) on this instance — auth, PRs, issues, API, and common workflows.
---

# GitHub Skill

Use this skill whenever you need to interact with GitHub — creating PRs, checking CI, managing issues, querying the API, or installing/restoring `gh`.

---

## Installation

`gh` is a binary installed to `/data/bins/gh` so it persists across restarts.

### Check if installed
```bash
ls /data/bins/gh && /data/bins/gh --version
```

### Install / restore after restart
```bash
GH_VERSION=$(curl -ksSL https://api.github.com/repos/cli/cli/releases/latest | /data/bins/jq -r '.tag_name' | sed 's/^v//')
curl -kL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz" | tar xz -C /tmp
mv "/tmp/gh_${GH_VERSION}_linux_amd64/bin/gh" /data/bins/gh
rm -rf "/tmp/gh_${GH_VERSION}_linux_amd64"
chmod +x /data/bins/gh
```

---

## Auth

Auth uses the `GITHUB_TOKEN` env var (persisted via `env_set`). Pass it explicitly on every call:

```bash
SSL_CERT_FILE=/data/cacert.pem GH_TOKEN="$GITHUB_TOKEN" /data/bins/gh <command>
```

**Always set both:**
- `SSL_CERT_FILE=/data/cacert.pem` — SSL certs are missing from this container
- `GH_TOKEN="$GITHUB_TOKEN"` — token is in the env, not in gh's config

### Verify auth
```bash
SSL_CERT_FILE=/data/cacert.pem GH_TOKEN="$GITHUB_TOKEN" /data/bins/gh api user --jq '.login'
```

---

## Common Commands

### Pull Requests
```bash
# Create a PR (must be run from inside the repo directory)
cd /data/source
SSL_CERT_FILE=/data/cacert.pem GH_TOKEN="$GITHUB_TOKEN" /data/bins/gh pr create \
  --title "Title" \
  --body "Description" \
  --base main \
  --head <branch>

# View a PR
SSL_CERT_FILE=/data/cacert.pem GH_TOKEN="$GITHUB_TOKEN" /data/bins/gh pr view <number>

# List open PRs
SSL_CERT_FILE=/data/cacert.pem GH_TOKEN="$GITHUB_TOKEN" /data/bins/gh pr list

# Check PR status / CI
SSL_CERT_FILE=/data/cacert.pem GH_TOKEN="$GITHUB_TOKEN" /data/bins/gh pr checks <number>
```

### Issues
```bash
# List issues
SSL_CERT_FILE=/data/cacert.pem GH_TOKEN="$GITHUB_TOKEN" /data/bins/gh issue list

# Create an issue
SSL_CERT_FILE=/data/cacert.pem GH_TOKEN="$GITHUB_TOKEN" /data/bins/gh issue create \
  --title "Title" --body "Description"
```

### Raw API
```bash
# GET any GitHub API endpoint
SSL_CERT_FILE=/data/cacert.pem GH_TOKEN="$GITHUB_TOKEN" /data/bins/gh api repos/kvendrik/backoffice/pulls

# PATCH (e.g. update PR body)
SSL_CERT_FILE=/data/cacert.pem GH_TOKEN="$GITHUB_TOKEN" /data/bins/gh api \
  repos/kvendrik/backoffice/pulls/1 \
  --method PATCH \
  --field body='New body text' \
  --jq '.html_url'
```

**Note:** `gh pr edit` may fail with a GraphQL deprecation warning — use the raw API (`gh api`) instead.

---

## Repos

| Repo | Path on volume | Purpose |
|---|---|---|
| `kvendrik/backoffice` | `/data/source` | Server source (public) |
| `kvendrik/backoffice-volume` | `/data` | Persistent volume (private) |

---

## PR Workflow

1. Create a feature branch: `git checkout -b <branch-name>`
2. Make changes, run `bun run test` to verify
3. Commit and push the branch (ask Koen first — see git skill)
4. Open a PR with `gh pr create`
5. Check CI with `gh pr checks <number>`

**Important:** The repo is public — never include secrets, tokens, or private data in commits or PR descriptions.

---

## Gotchas

- `gh pr edit` fails with a GraphQL deprecation warning — use `gh api` with `--method PATCH` instead
- Always `cd` into the repo directory before running `gh pr` commands — `gh` infers the repo from the git remote
- Token scope is limited to `kvendrik/backoffice` and `kvendrik/backoffice-volume` only
