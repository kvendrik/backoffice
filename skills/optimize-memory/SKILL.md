---
name: optimize-memory
description: Audit, score, and optimize the Backoffice MEMORY.md file. Use this skill whenever the user asks to optimize, clean up, or improve memory, or when memory feels stale, too long, bloated, or out of date. Also trigger proactively if memory_read reveals duplicate sections, outdated paths, contradictory instructions, or relative dates that have decayed in meaning.
---

# Optimize Memory Skill

Keeps MEMORY.md lean, accurate, and useful. Inspired by Auto-Dream's cognitive memory architecture.

---

## Priority Markers

Entries in MEMORY.md can be tagged to control how they're treated during optimization:

| Marker | Meaning |
|--------|---------|
| `⚠️ PERMANENT` | Never archive or remove — critical instructions |
| `🔥 HIGH` | High importance — preserve unless clearly superseded |
| `📌 PIN` | Keep in place — pinned reference |
| *(no marker)* | Normal — subject to scoring and possible archival |

When adding new important entries to memory, apply the appropriate marker.

---

## Step 1 — Audit

Read the current memory file:

```bash
cat /data/MEMORY.md
wc -l /data/MEMORY.md
```

Then spot-check key claims against reality:

```bash
ls <path mentioned in memory>
ls /data/node_modules/
ls /data/cycling/
ls /data/skills/
```

---

## Step 2 — Score each section

For each section or entry, compute an informal importance score:

```
score = base_weight × recency × reference_frequency
```

- **base_weight**: permanent=always keep, high=0.9, normal=0.5, no marker=0.3
- **recency**: still-accurate=1.0, uncertain=0.5, known-stale=0.0
- **reference_frequency**: how often this path/command/fact appears in logs

```bash
# Check how often a path or command is referenced in logs
grep -c "<term>" /data/log.jsonl
```

Flag entries with score < 0.3 as archival candidates.

---

## Step 3 — Identify issues

Flag any entry that is:

- **Stale** — path no longer exists, package moved, command syntax changed
- **Duplicate** — same fact in two places
- **Contradictory** — two entries disagree (e.g. two token paths)
- **Superseded** — old instruction overridden by a newer one
- **Relative date** — "recently", "last week", "yesterday" (convert to absolute date)
- **Low-score** — score < 0.3 and no priority marker

---

## Step 4 — Plan changes

Before editing, list what will change and why:

```
- Archive: <entry> — stale/superseded/low-score
- Update: <entry> — wrong path → correct path
- Merge: <A> + <B> — duplicate
- Convert: <entry> — relative date → absolute date
- Trim: <section> — verbose, reduce without losing meaning
```

Never plan to remove a `⚠️ PERMANENT` or `📌 PIN` entry.

---

## Step 5 — Apply

Use `memory_patch` for targeted edits (preferred):

```
memory_patch: fix stale path / remove duplicate / correct outdated command
```

For archived entries, move them to the bottom of the file under:

```markdown
## Archive
<!-- Entries below are preserved but no longer active -->
```

Use `memory_write` only for a full rewrite if the file is severely fragmented. When doing so, preserve all accurate information — never summarize away useful detail.

---

## Step 6 — Health check

After applying changes, compute a simple health score:

| Metric | Check |
|--------|-------|
| **Freshness** | Are all paths/commands verified as still correct? |
| **Efficiency** | Is the file under ~150 lines? |
| **Coherence** | No contradictions between sections? |
| **Startup intact** | Startup protocol still present and correct? |
| **Skills section** | scan.ts still listed as step 3? |

Target: all green. Report the score as: `Freshness ✓ Efficiency ✓ Coherence ✓ Startup ✓ Skills ✓`

---

## Step 7 — Log

Append to `/data/IMPROVEMENT_LOG.md`:

```
## YYYY-MM-DD — Memory optimization
- Health before: <issues found>
- Health after: <metrics>
- Lines before/after: N → M
- Changes: <summary>
```

---

## Principles

- **Never delete — archive** — stale entries go to `## Archive`, never hard-removed
- **Score before cutting** — don't trim based on feel; use the scoring formula
- **Markers are law** — `⚠️ PERMANENT` and `📌 PIN` entries are untouchable
- **Absolute dates only** — convert all relative time references to real dates
- **Patch over rewrite** — full rewrites risk losing information
- **Startup protocol is sacred** — never remove or reorder the 3-step startup sequence
