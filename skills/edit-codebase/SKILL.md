---
name: edit-codebase
description: >
  Use this skill whenever asked to edit, refactor, add features to, or fix bugs in a
  codebase. Triggers include: "add X to the codebase", "refactor Y", "fix this bug",
  "update the types in Z", "change how X works", or any task that involves reading and
  modifying source files. Always follow this skill rather than jumping straight to editing —
  the reconnaissance phase prevents hard-to-undo mistakes.
---

# Codebase Editing Skill

Editing a codebase well requires three phases: **understand → change → verify**.
Never skip the understand phase, even for "simple" changes.

---

## Phase 1: Reconnaissance

Before touching any file, build a mental model of the codebase.

### 1a. Map the structure
```bash
find <root> -type f | grep -v node_modules | grep -v .git | grep -v dist | head -80
# Or with tree if available:
tree -I 'node_modules|dist|.git|.next|__pycache__' <root> -L 3
```

### 1b. Read the key config files
- `package.json` / `bun.lock` → runtime, scripts, dependencies
- `tsconfig.json` → compiler options, path aliases
- `pyproject.toml` / `go.mod` → language equivalents
- Any `README.md` at the root or in relevant subdirs
- `.env.example` → understand expected environment

### 1c. Locate the relevant code
Use grep or ripgrep to find symbols before opening files:
```bash
grep -rn "FunctionName\|ClassName\|'module-name'" src/ --include="*.ts"
rg "symbolName" src/ -n --type ts
```
Note the **exact file path and line number** before proceeding.

### 1d. Read files with line numbers
```bash
cat -n src/path/to/file.ts
# Or a targeted range (e.g. lines 40-80):
sed -n '40,80p' src/path/to/file.ts | nl -ba -v 40
```

**Never rely on assumptions about file contents. Always read first.**

### 1e. Trace the call chain
For non-trivial changes, follow the data flow end-to-end:
- Where is this function called from? (`grep -rn "functionName"`)
- What does it call? (read the body)
- What types flow through it? (check interfaces/types)

---

## Phase 2: Making the Change

### Choose the right editing tool

| Situation | Tool |
|---|---|
| Surgical line-level edit | `patch_file` (Backoffice tool) |
| Simple string replacement | `sed -i 's/old/new/g'` |
| Rewrite a small file (<80 lines) | `cat > file << 'EOF'` |
| Insert at a specific line | `sed -i 'Ni\<line>'` |
| Structured AST-level change | Write a one-shot transform script, run it, delete it |

**Always dry-run sed before applying:**
```bash
sed -n 's/old/new/gp' file.ts   # preview matches first
sed -i 's/old/new/g' file.ts    # then apply
```

### Core principles

These mirror how Cursor and Claude Code approach edits — apply them here too:

1. **Minimal diff** — change only what's needed. Don't reformat surrounding code.
2. **Match the local style** — indentation, quotes, semicolons, trailing commas. Read the surrounding code and mirror it.
3. **Understand before fixing** — read the full error or bug description, trace the root cause, then edit. Never patch symptoms.
4. **One logical change per commit** — don't bundle unrelated edits.
5. **Check imports** — adding or moving code usually requires updating imports. Check both the file you're editing and any barrel/index files.
6. **Check exports** — new exports often need to be re-exported from an index file to be accessible.
7. **Respect types** — in TypeScript projects, don't introduce `any` silently. Extend or narrow the existing types correctly.
8. **Preserve invariants** — if the codebase has patterns (e.g. all handlers return `Result<T>`, all API responses are wrapped), follow them.

### Common patterns

#### Adding a new command/handler to an existing CLI or router
1. Grep for an existing command name to find where commands are registered
2. Read one existing handler in full to understand the pattern
3. Copy the pattern, adapt to the new command
4. Register in the same place
5. Update any help text, command list, or type union

#### Refactoring a function
1. Find all call sites: `grep -rn "functionName"`
2. Read the full current signature
3. Make the change in the definition
4. Update every call site
5. Type-check

#### Adding a new module/file
1. Check if there's an `index.ts` barrel that needs updating
2. Match the naming convention of sibling files
3. Match the module pattern (default vs named exports, ESM vs CJS)

#### Fixing a TypeScript error
1. Run `tsc --noEmit 2>&1` to get the full error output
2. Read the error carefully — location, expected type, actual type
3. Find the type definition (`grep -rn "interface Foo\|type Foo"`)
4. Fix the root type, not a downstream cast
5. Re-run `tsc --noEmit` to confirm clean

---

## Phase 3: Verification

### 3a. Review your own diff
```bash
git diff
```
Read it as if you're reviewing someone else's PR. Does it look exactly right?
Watch for: unintended deletions, leftover debug lines, wrong indentation, missing import.

### 3b. Type-check (TypeScript)
```bash
bun run tsc --noEmit
# or if a typecheck script exists:
bun run typecheck
```

### 3c. Lint
```bash
bun run lint
# or:
bun run eslint src/
```

### 3d. Run tests
```bash
bun test
bun run test
```
If tests fail due to your change, fix them. If they were already failing, note that separately.

### 3e. Run the thing
Briefly start the server or run the script to confirm there are no startup errors:
```bash
bun run src/index.ts
```

### 3f. Summarize before committing
Before handing off to the Git Skill, show:
- Which files changed
- One-line description of each change
- Any follow-up work identified (noted, not acted on without asking)

---

## After editing

Hand off to the **Git Skill** (`/app/skills/git/SKILL.md`) for commit and push workflow.
Always follow that skill's rules: show a diff summary, commit locally, ask before pushing.
