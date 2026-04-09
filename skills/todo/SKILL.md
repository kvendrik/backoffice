---
name: todo
description: How to maintain planning/TODO.md — ordering by impact, formatting, referencing planning docs, and when to add or update items.
---

# TODO Skill

/data/planning/TODO.md is the single source of truth for outstanding work. Use this skill whenever reading, adding to, or reorganising the TODO list.

## Ordering

Items are ordered by impact within each priority tier — most important or most blocking first. When adding a new item, place it where it belongs relative to existing items, not just at the bottom.

Priority tiers:

| Tier | Emoji | Meaning |
|---|---|---|
| Blocking / High Priority | red | Blocks other work or is overdue |
| Source Changes | orange | Requires a PR and plan-mode |
| In Progress / Upcoming | yellow | Planned and scoped, not yet started |
| Nice to Have / Future | green | Good ideas without a fixed timeline |

## Format

Each item is a single line:

  - [ ] Bold title -- concise description of what needs doing -> planning/doc.md

- Title is bolded, description follows a dash
- If a planning document exists, reference it with -> planning/filename.md
- If blocked by another item, note it inline: (blocked on X)
- Completed items: change [ ] to [x] and move to a Done section at the bottom

## When to Add Items

Add a TODO item when:
- A task was identified during planning but not immediately acted on
- A self-improvement loop finds a systemic issue requiring a larger fix
- A decision in a planning doc generates follow-up actions
- The user mentions something to do later

## When to Update Items

- A planning doc is created or renamed: update the reference
- An item is unblocked: remove the blocked note
- Scope changes: update the description in place
- Item is completed: mark [x] and move to Done

## Relationship to Planning Docs

TODO.md is a summary index -- it should never duplicate detail from planning docs. If an item needs more context, that context lives in planning/doc.md and the TODO item links to it.

Never write implementation details, design decisions, or QA notes into TODO.md -- those belong in the planning doc.
