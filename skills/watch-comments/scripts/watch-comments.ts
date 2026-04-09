#!/usr/bin/env bun
/**
 * watch-comments.ts
 * Polls GitHub for new comments on issues and PRs in a repo.
 *
 * Usage:
 *   bun watch-comments.ts <owner/repo> [options]
 *
 * Options:
 *   --interval <seconds>   Poll interval in seconds (default: 60)
 *   --pr <number>          Watch a specific PR only
 *   --issue <number>       Watch a specific issue only
 *   --once                 Run one poll then exit (useful for testing)
 *   --state-dir <path>     Where to store seen-IDs state
 *                          (default: /data/skills/watch-comments/state)
 *
 * Env vars required:
 *   GITHUB_TOKEN           GitHub personal access token
 *   SSL_CERT_FILE          Path to CA bundle (e.g. /data/cacert.pem)
 *
 * Env vars optional:
 *   TELEGRAM_BOT_TOKEN     If set, sends new comments via Telegram
 *   TELEGRAM_CHAT_ID       Required if TELEGRAM_BOT_TOKEN is set
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

// ── Args ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function argValue(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : undefined;
}

const repo = args[0];
if (!repo || repo.startsWith("--")) {
  console.error(
    "Usage: bun watch-comments.ts <owner/repo> [--interval 60] [--pr N] [--issue N] [--once]"
  );
  process.exit(1);
}
if (!repo.includes("/")) {
  console.error(`Invalid repo format "${repo}" — expected owner/repo`);
  process.exit(1);
}

const intervalSecs = parseInt(argValue("--interval") ?? "60", 10);
const watchPR = argValue("--pr") != null ? parseInt(argValue("--pr")!, 10) : null;
const watchIssue = argValue("--issue") != null ? parseInt(argValue("--issue")!, 10) : null;
const runOnce = args.includes("--once");
const stateDir = argValue("--state-dir") ?? "/data/skills/watch-comments/state";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
if (!GITHUB_TOKEN) {
  console.error("GITHUB_TOKEN env var is required");
  process.exit(1);
}

const SSL_CERT_FILE = process.env.SSL_CERT_FILE ?? "/data/cacert.pem";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const GH = "/data/gh";

// ── State ─────────────────────────────────────────────────────────────────────

interface SeenCursors {
  issueComments: number;
  reviewComments: number;
  reviews: number;
}

interface State {
  // key = "issue:<n>" or "pr:<n>"
  seen: Record<string, SeenCursors>;
}

const stateFile = join(stateDir, `${repo.replace("/", "-")}.json`);

function loadState(): State {
  if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });
  if (!existsSync(stateFile)) return { seen: {} };
  try {
    return JSON.parse(readFileSync(stateFile, "utf8")) as State;
  } catch {
    return { seen: {} };
  }
}

function saveState(state: State) {
  writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

// ── GitHub API ────────────────────────────────────────────────────────────────

async function ghApi<T>(path: string): Promise<T> {
  const proc = Bun.spawn([GH, "api", path, "--paginate"], {
    env: { ...process.env, GH_TOKEN: GITHUB_TOKEN!, SSL_CERT_FILE },
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  const code = await proc.exited;
  if (code !== 0) throw new Error(`gh api ${path} failed (${code}): ${err.trim()}`);
  const cleaned = out.trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // --paginate outputs one JSON array per page, concatenated with newlines
    const pages = cleaned.split(/\n(?=\[)/).map((p) => JSON.parse(p) as unknown[]);
    return pages.flat() as unknown as T;
  }
}

interface GHIssue {
  number: number;
  title: string;
  pull_request?: unknown;
}
interface GHComment {
  id: number;
  user: { login: string };
  body: string;
  html_url: string;
  created_at: string;
}
interface GHReview {
  id: number;
  user: { login: string };
  body: string;
  html_url: string;
  state: string;
  submitted_at: string;
}

// ── Formatting ────────────────────────────────────────────────────────────────

function formatItem(
  kind: "issue" | "pr",
  number: number,
  title: string,
  type: string,
  c: GHComment | GHReview
): string {
  const when = "created_at" in c ? c.created_at : (c as GHReview).submitted_at;
  const preview =
    c.body.trim().slice(0, 300) + (c.body.length > 300 ? "…" : "");
  return [
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `📬 New ${type} on ${kind.toUpperCase()} #${number} in ${repo}`,
    `   "${title}"`,
    `   by @${c.user.login} at ${new Date(when).toISOString()}`,
    `   ${c.html_url}`,
    ``,
    `   ${preview}`,
  ].join("\n");
}

async function sendTelegram(text: string) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  const esc = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: esc,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    }
  );
}

// ── Poll one issue or PR ──────────────────────────────────────────────────────

async function pollItem(
  state: State,
  kind: "issue" | "pr",
  number: number,
  title: string,
  out: string[]
) {
  const key = `${kind}:${number}`;
  const seen: SeenCursors = state.seen[key] ?? {
    issueComments: 0,
    reviewComments: 0,
    reviews: 0,
  };

  // (a) Top-level thread comments (both issues and PRs)
  const issueComments = await ghApi<GHComment[]>(
    `repos/${repo}/issues/${number}/comments`
  );
  const newIC = issueComments.filter((c) => c.id > seen.issueComments);
  for (const c of newIC) out.push(formatItem(kind, number, title, "comment", c));
  if (newIC.length) seen.issueComments = Math.max(...newIC.map((c) => c.id));

  // (b) Inline review comments (PRs only)
  if (kind === "pr") {
    const reviewComments = await ghApi<GHComment[]>(
      `repos/${repo}/pulls/${number}/comments`
    );
    const newRC = reviewComments.filter((c) => c.id > seen.reviewComments);
    for (const c of newRC)
      out.push(formatItem(kind, number, title, "inline comment", c));
    if (newRC.length)
      seen.reviewComments = Math.max(...newRC.map((c) => c.id));

    // (c) Submitted review bodies (PRs only)
    const reviews = await ghApi<GHReview[]>(
      `repos/${repo}/pulls/${number}/reviews`
    );
    const newRev = reviews.filter(
      (r) => r.id > seen.reviews && r.body?.trim()
    );
    for (const r of newRev)
      out.push(formatItem(kind, number, title, `review (${r.state})`, r));
    if (newRev.length) seen.reviews = Math.max(...newRev.map((r) => r.id));
  }

  state.seen[key] = seen;
}

// ── Main poll loop ────────────────────────────────────────────────────────────

async function poll() {
  const state = loadState();
  const newComments: string[] = [];
  const errors: string[] = [];

  if (watchPR !== null) {
    try {
      const pr = await ghApi<{ title: string }>(
        `repos/${repo}/pulls/${watchPR}`
      );
      await pollItem(state, "pr", watchPR, pr.title, newComments);
    } catch (e) {
      errors.push(`PR #${watchPR}: ${e}`);
    }
  } else if (watchIssue !== null) {
    try {
      const issue = await ghApi<{ title: string }>(
        `repos/${repo}/issues/${watchIssue}`
      );
      await pollItem(state, "issue", watchIssue, issue.title, newComments);
    } catch (e) {
      errors.push(`Issue #${watchIssue}: ${e}`);
    }
  } else {
    // All open issues + PRs
    const items = await ghApi<GHIssue[]>(
      `repos/${repo}/issues?state=open&per_page=100`
    );
    for (const item of items) {
      const kind = item.pull_request ? "pr" : "issue";
      try {
        await pollItem(state, kind, item.number, item.title, newComments);
      } catch (e) {
        errors.push(`${kind} #${item.number}: ${e}`);
      }
    }
  }

  saveState(state);

  for (const msg of newComments) {
    console.log(msg);
    await sendTelegram(msg);
  }

  for (const e of errors) console.error(`[error] ${e}`);

  if (newComments.length === 0 && !runOnce) {
    process.stdout.write(
      `[${new Date().toISOString()}] No new comments. Next poll in ${intervalSecs}s\r`
    );
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

console.log(`👁  Watching ${repo} — polling every ${intervalSecs}s`);
if (watchPR !== null) console.log(`   Scope: PR #${watchPR} only`);
else if (watchIssue !== null) console.log(`   Scope: Issue #${watchIssue} only`);
else console.log(`   Scope: all open issues + PRs`);
console.log(`   State file: ${stateFile}`);
console.log(`   Telegram: ${TELEGRAM_BOT_TOKEN ? "enabled" : "disabled"}`);
console.log();

await poll();
if (!runOnce) setInterval(poll, intervalSecs * 1000);
