---
name: auto-research
description: Research a topic autonomously, run iterative experiments, self-improve, or investigate a problem deeply without step-by-step human involvement.
---

# Auto-Research Skill

Use this skill when asked to research a topic autonomously, run iterative experiments, self-improve, or investigate a problem deeply without step-by-step human involvement.

## The Core Pattern (Karpathy Loop)

Autonomous research works best with three ingredients:

1. **One editable asset** — a single script, config, or document the loop modifies
2. **One scalar metric** — an objectively measurable signal of improvement (test score, output quality, speed, token count, etc.)
3. **Fixed iteration budget** — each experiment is time/cost-bounded so runs are comparable and the loop can't go infinite

The human defines the goal and constraints in a markdown file. The agent runs experiments, keeps improvements (ratchet), discards regressions, and surfaces a report at the end.

---

## Loop Protocol

### Before starting
1. Define clearly in `/tmp/research-goal.md`:
   - **Objective**: What are we trying to improve or learn?
   - **Metric**: How will we measure success? (must be concrete and checkable)
   - **Editable scope**: What files/commands are in scope to change?
   - **Constraints**: What must NOT change? What counts as a regression?
   - **Budget**: Max N iterations, or max time
   - **Stopping criteria**: When is the result good enough to stop early?

2. Establish a **baseline** — measure the metric before any changes

### Each iteration
```
THINK  → Hypothesise what change might improve the metric
ACT    → Apply the change (one variable at a time)
MEASURE → Run the evaluation, record the metric
DECIDE → Improvement? Keep and commit. Regression? Revert.
LOG    → Append result to /tmp/research-log.md
REPEAT → Until budget exhausted or stopping criteria met
```

### After finishing
Write a summary to `/tmp/research-report.md`:
- Baseline vs final metric
- Top N changes that improved things (with magnitude)
- What was tried and failed (and why it probably failed)
- Recommended next steps

---

## Research Loop Types

### Type 1: Web Research Loop
For questions that require gathering information from multiple sources:

```
QUERY  → Search for the topic
READ   → Fetch and read the most relevant sources
EXTRACT → Pull key facts, contradictions, unknowns
REFINE → Identify what's still unclear; generate follow-up queries
REPEAT → Until confident in the answer (max 5 iterations)
SYNTHESISE → Write a structured summary
```

**When to stop**: When additional searches return no new information.

### Type 2: Code/Script Experiment Loop
For improving a script, prompt, or configuration:

```
BASELINE → Run current version, record metric
HYPOTHESISE → One specific change to try
MODIFY → Apply change to the single editable file
TEST → Run and measure
RATCHET → Keep if better, revert if worse
LOG → Record in /tmp/research-log.md
REPEAT → Up to budget
```

**When to stop**: Metric plateaus across 3 consecutive iterations, or budget exhausted.

### Type 3: Self-Improvement Loop
For improving Backoffice itself (skills, memory, workflows):

```
AUDIT → Check recent failures, inefficiencies, repeated mistakes
IDENTIFY → Pick the highest-impact issue
HYPOTHESISE → What change would fix it?
IMPLEMENT → Edit skill/memory/script
VALIDATE → Test the fix with a concrete example
COMMIT → Push to volume repo if validated
REPEAT → Next issue
```

---

## Key Principles

**Ratchet** — Only keep changes that measurably improve the metric. Never accept "seems about the same." If you can't measure it, define a proxy metric.

**One variable at a time** — Changing multiple things simultaneously makes it impossible to attribute the improvement. Change one thing, measure, decide, then move on.

**Constraints are as important as goals** — A loop that optimises for the wrong proxy will confidently go the wrong direction. Define what must NOT regress before starting.

**Goodhart's Law** — Any metric that an autonomous loop optimises will eventually be gamed. Always sanity-check that the metric still corresponds to the real goal.

**Fixed budget** — Every iteration must have a time/cost bound. An unbounded loop will run forever.

**Log everything** — Even failed experiments are valuable. Document what was tried and why it failed.

---

## Templates

### research-goal.md
```markdown
## Objective
[What are we trying to learn or improve?]

## Metric
[Concrete, measurable signal. How will we know it improved?]

## Baseline
[Current measurement before any changes]

## Editable scope
[What can be modified?]

## Constraints (must NOT change)
[What counts as a regression? What is off-limits?]

## Budget
[Max N iterations / max time]

## Stopping criteria
[What good-enough looks like]
```

### research-log.md entry
```markdown
### Iteration N — [timestamp]
**Hypothesis**: [What change and why]
**Change**: [What was actually done]
**Result**: [Metric before → after]
**Decision**: KEEP / REVERT
**Notes**: [Why it worked or didn't]
```

---

## Backoffice-Specific Notes

- Write goals to `/tmp/research-goal.md`, logs to `/tmp/research-log.md`, report to `/tmp/research-report.md`
- For web research: use `web_search` and `web_fetch` — search → fetch full page → extract → refine
- For code loops: always test before committing; never commit a regression
- For self-improvement: read the self-improve skill first (`/data/skills/self-improve/SKILL.md`)
- For anything involving pushing to git: follow git skill (`/data/skills/git/SKILL.md`) — ask before pushing
- Context window is finite — summarise findings into `/tmp/research-log.md` as you go rather than keeping everything in memory
