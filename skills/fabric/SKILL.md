# Fabric Skill

Use this skill whenever the user asks you to summarise, analyse, extract insights from, or transform any content — articles, YouTube videos, transcripts, essays, code, etc.

## What Fabric Is

Fabric is a collection of 250+ expert-crafted AI system prompts ("patterns"), each designed for a specific task. Rather than calling Fabric's own API, Claude reads the pattern's system prompt and executes it directly.

## Directory Layout

```
/data/fabric/
  fabric            # Fabric CLI binary (v1.4.442)
  fabric-prompt.ts  # Helper: reads a pattern's system.md and prints it
  patterns/         # 250+ pattern directories, each with a system.md
    extract_wisdom/
    summarize/
    write_essay/
    ... etc
```

## How to Use a Pattern

### 1. Discover patterns
```bash
bun /data/fabric/fabric-prompt.ts --list
```
This lists all 250+ available pattern names.

### 2. Read a pattern's prompt
```bash
bun /data/fabric/fabric-prompt.ts <pattern_name>
```
This prints the full system prompt. Claude reads it and uses it as instructions for processing the user's content.

### 3. Apply it
Read the system.md, then apply those instructions to the user's content directly. No API call needed — Claude IS the executor.

**Example flow:**
```bash
# User: "Extract wisdom from this article: <text>"
bun /data/fabric/fabric-prompt.ts extract_wisdom
# → Claude reads the prompt, applies it to the article, returns structured output
```

## Most Useful Patterns

| Pattern | What it does |
|---|---|
| `extract_wisdom` | Extracts ideas, insights, quotes, habits, facts, recommendations |
| `summarize` | Clean structured summary with key points and takeaways |
| `write_essay` | Writes a full essay on a topic |
| `write_micro_essay` | Tight 500-word essay |
| `improve_writing` | Rewrites and tightens any text |
| `analyze_claims` | Breaks down truth/accuracy of claims |
| `analyze_debate` | Scores a debate, finds strongest arguments |
| `analyze_paper` | Structured breakdown of an academic paper |
| `to_flashcards` | Turns content into study flashcards |
| `create_conceptmap` | Generates an interactive HTML visual concept map |
| `find_logical_fallacies` | Spots fallacies in any argument |
| `explain_code` | Explains what a piece of code does |
| `create_coding_project` | Scaffolds a project from a description |
| `rate_content` | Scores quality of content |
| `get_wow_per_minute` | Rates how interesting content is per minute |

## YouTube Videos

Fabric can fetch YouTube transcripts. To use:
```bash
# Fetch transcript
HOME=/data SSL_CERT_FILE=/data/cacert.pem /data/fabric/fabric -y <youtube_url> 2>/dev/null
```
Then pipe the transcript through the pattern of your choice by reading its system.md and applying it.

## Updating Patterns

Patterns are cloned from the fabric GitHub repo. To update to the latest:
```bash
GIT_SSL_CAINFO=/data/cacert.pem git clone --depth=1 --filter=blob:none --sparse \
  https://github.com/danielmiessler/fabric.git /tmp/fabric-repo-update
cd /tmp/fabric-repo-update && git sparse-checkout set data/patterns
cp -r /tmp/fabric-repo-update/data/patterns/* /data/fabric/patterns/
```

## Key Rules

- Always read `system.md` first with `fabric-prompt.ts` — never guess what a pattern does
- When unsure which pattern to use, run `--list` and pick the most relevant name
- For YouTube URLs, fetch the transcript first, then apply the pattern
- Patterns expect plain text input — strip any HTML before passing content
