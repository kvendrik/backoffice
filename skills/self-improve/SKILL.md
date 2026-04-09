---
name: self-improve
description: Analyze Backoffice failure logs, reproduce issues, implement fixes ordered by impact, and verify results. Use this skill whenever the user asks to self-improve, run an auto-research loop, fix recurring errors, audit what's going wrong, analyze logs, or debug persistent failures. Also trigger proactively if you notice repeated tool errors in the current session.
---

# Self-Improvement Skill

Runs a full autonomous improvement loop: analyze → reproduce → fix → verify → log.

---

## Step 1 — Analyze

```bash
bun /data/skills/self-improve/scripts/analyze.ts
```

Output: ranked failure patterns with frequency, example error text, and a reproduction command per pattern.

---

## Step 2 — Reproduce (highest impact first)

Before fixing anything, run the reproduction command for the top pattern to confirm it's still live:

```bash
<reproduction_command from analyzer output>
```

- If it **fails as expected** → proceed to fix
- If it **passes** → already resolved, log as such and move to next pattern

---

## Step 3 — Fix

Choose mechanism based on root cause:

**Memory fix** — wrong path, stale command syntax, outdated instruction:
→ Use `memory_patch` or `memory_append` to update `/data/MEMORY.md`

**Script fix** — repeated ad-hoc commands failing the same way:
→ Write a helper to `/data/skills/self-improve/scripts/` or `/data/cycling/`

**Code fix** — issue in Backoffice source (`/app/src/`), requires `GITHUB_TOKEN`:
```bash
git clone https://$GITHUB_TOKEN@github.com/kvendrik/backoffice.git /tmp/backoffice-clone
# edit file
cd /tmp/backoffice-clone
git config user.email "backoffice@railway.app"
git config user.name "Backoffice"
git add -A
git commit -m "fix: <description>"
git push
# Note: push triggers Railway redeploy — current session will die. Expected.
```

---

## Step 4 — Verify

Re-run the same reproduction command from Step 2. Confirm the error no longer occurs.

- Passes → proceed to log
- Still fails → revise fix and retry

---

## Step 5 — Log

Append to `/data/IMPROVEMENT_LOG.md`:

If the fix reveals a larger task (e.g. a source change, a new feature needed, a recurring systemic issue), add a concise TODO item to `/data/planning/TODO.md` under the appropriate priority section.

```
## YYYY-MM-DD — <pattern name>
- Frequency: <N occurrences>
- Reproduction: `<command>`
- Root cause: <explanation>
- Fix: <what changed>
- Mechanism: memory | script | code
- Verified: yes | no
```

---

## Auto-research loop

To run a full unsupervised pass:

1. Run analyzer → get ranked patterns
2. For each pattern (top to bottom, stop after 3 fixes per session):
   a. Run reproduction command
   b. If reproduced → fix → verify → log
   c. If not reproduced → log as "already resolved", skip
3. Report summary to user
