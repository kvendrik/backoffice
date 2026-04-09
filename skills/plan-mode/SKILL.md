---
name: plan-mode
description: When making non-trivial changes to code or infrastructure, ask the user if they want to plan first. Planning means iterating on a document in planning/ before writing any code, and shipping changes via a PR instead of pushing directly to main.
---

# Plan Mode Skill

Use this skill when asked to make any non-trivial change to code, infrastructure, or configuration. The goal is to think before acting — catch design issues on paper rather than in code.

---

## When to Invoke Plan Mode

Ask the user "Would you like to plan this first?" before starting work on:

- Any new feature or tool
- Changes to existing source files in `/data/source/`
- Dockerfile or entrypoint changes
- Anything that would result in a PR

**Don't invoke plan mode for:**
- Small bug fixes that are clearly scoped (e.g. fixing a typo, correcting a constant)
- Volume-only changes (scripts in `/data/`, memory updates, skill edits)
- Purely additive work explicitly scoped by the user ("just add this line")

---

## The Planning Workflow

### Step 1 — Write a plan

Create a plan document in `/data/planning/<feature-name>.md`. A good plan covers:

- **Problem** — what is broken or missing and why it matters
- **Constraints** — what must not change, what is off-limits
- **Options** — 2–3 approaches with pros/cons
- **Decision** — which option and why
- **Pending actions** — concrete list of changes required

### Step 2 — QA the plan

Run the auto-research QA loop (see `/data/skills/auto-research/SKILL.md`) until zero issues remain. Common things to check:

- Are there internal contradictions?
- Do the options actually solve the stated problem?
- Are there edge cases or interactions not addressed?
- Are all pending actions specific and actionable?

### Step 3 — Get approval

Present the plan to the user. Don't start writing code until they say yes.

### Step 4 — Implement on a branch

Never push changes directly to `main`. Always:

```bash
cd /data/source
git checkout -b <descriptive-branch-name>
# make changes
bun run test   # must pass before committing
git add -A && git commit -m "..."
GIT_SSL_CAINFO=/data/cacert.pem git push -u origin <branch>
```

### Step 5 — Open a PR

```bash
cd /data/source
SSL_CERT_FILE=/data/cacert.pem GH_TOKEN="$GITHUB_TOKEN" /data/bins/gh pr create \
  --title "Short description" \
  --body "What, why, and how. No secrets." \
  --base main \
  --head <branch>
```

PR description must include:
- What the change does
- Why it's needed
- Any decisions made (and why alternatives were rejected)
- Testing notes

**The repo is public — never include secrets, tokens, or private data.**

### Step 6 — Review before merging

Run a code review pass on the PR (see review checklist below). Fix issues on the branch, push updates. Only merge when the review is clean.

---

## Review Checklist

Before considering a PR ready:

- [ ] Passes `bun run test` (lint + typecheck)
- [ ] No hardcoded secrets or private paths
- [ ] Error cases are handled (not just the happy path)
- [ ] Existing behaviour is unchanged unless explicitly intended
- [ ] PR description is accurate and complete

---

## Branch Naming

| Type | Format | Example |
|---|---|---|
| New feature | `add-<thing>` | `add-background-flag` |
| Bug fix | `fix-<thing>` | `fix-jobs-fallback-path` |
| Refactor | `refactor-<thing>` | `refactor-shell-tool` |
| Infrastructure | `infra-<thing>` | `infra-skills-in-source` |

---

## Relationship to Other Skills

- **git skill** — push rules, commit workflow, repo paths
- **auto-research skill** — QA loop for iterating on plans to zero issues
- **self-modify skill** — rules for touching Backoffice source (always ask first)
- **github skill** — how to use `gh` for PRs, CI checks, API calls
