---
name: telegram
description: Send a Telegram message to the user. Use when you need to notify the user of something (e.g. a long task completing, a reminder, or sharing a quick update). Requires TELEGRAM_BOT_TOKEN and TELEGRAM_USER_ID env vars.
---

# Telegram Skill

Send messages to the user via Telegram.

## Usage

```bash
bun /app/skills/telegram/scripts/send.ts "Your message here"
```

Supports Markdown formatting in messages.

## Setup

If the env vars are not set, the script will print setup instructions. Run it once to check:

```bash
bun /app/skills/telegram/scripts/send.ts test
```
