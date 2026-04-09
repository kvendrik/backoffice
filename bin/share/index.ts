#!/usr/bin/env bun
/**
 * share — Backoffice file sharing CLI
 *
 * Usage:
 *   share server              Start the share HTTP server (run with background: true)
 *   share add <path>          Register a file and print a share URL
 *   share list                Show all active links
 *   share rm <token|path>     Revoke a link by token prefix or file path
 *   share -h                  Show this help
 */

import { existsSync, statSync, unlinkSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { extname, resolve, dirname } from "node:path";
import {
  readStore,
  writeStore,
  pruneStore,
  isAllowedPath,
  formatTimeRemaining,
  STORE_PATH,
  type TokenEntry,
} from "./store.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_PORT = parseInt(process.env["SHARE_PORT"] ?? "3001");
const DEFAULT_MINUTES = 10;
const DEFAULT_TIMES = 1;
const DEFAULT_MAX_BYTES = 100 * 1024 * 1024; // 100 MB
const CLEANUP_INTERVAL_MS = 60_000;

const MIME: Record<string, string> = {
  ".pdf":  "application/pdf",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif":  "image/gif",
  ".webp": "image/webp",
  ".svg":  "image/svg+xml",
  ".zip":  "application/zip",
  ".tar":  "application/x-tar",
  ".gz":   "application/gzip",
  ".json": "application/json",
  ".txt":  "text/plain",
  ".md":   "text/markdown",
  ".html": "text/html",
  ".csv":  "text/csv",
  ".mp4":  "video/mp4",
  ".mp3":  "audio/mpeg",
};

const SECURE_HEADERS = {
  "Cache-Control":           "no-store",
  "Referrer-Policy":         "no-referrer",
  "X-Content-Type-Options":  "nosniff",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function mimeFor(filePath: string): string {
  return MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function baseUrl(port: number): string {
  return (process.env["SHARE_PUBLIC_URL"] ?? `http://localhost:${String(port)}`).replace(/\/$/, "");
}

function ensureStoreDir(): void {
  const dir = dirname(STORE_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg && arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        result[key] = next;
        i++;
      } else {
        result[key] = true;
      }
    }
  }
  return result;
}

// ── Help ──────────────────────────────────────────────────────────────────────

function printHelp(): void {
  console.log(`
share — Backoffice file sharing

USAGE
  share server                   Start the HTTP server on port ${String(DEFAULT_PORT)}
  share add <path> [flags]       Register a file, print the share URL
  share list                     Show active links with time and uses remaining
  share rm <token|path>          Revoke a link by token prefix or file path

ADD FLAGS
  --minutes <n>                  Link lifetime in minutes (default: ${String(DEFAULT_MINUTES)}, max: 60)
  --times <n>                    Max downloads before expiry (default: ${String(DEFAULT_TIMES)})
  --delete-after                 Delete source file after final download
  --max-size <bytes>             Reject files larger than this (default: 100MB)

SERVER FLAGS
  --port <n>                     Port to listen on (default: ${String(DEFAULT_PORT)})

EXAMPLES
  # Start the server (always use shell background: true)
  shell(background: true, command: "bun /app/bin/share server")

  # Share a file for 10 minutes, single download
  share add /tmp/report.pdf --minutes 10

  # Share a file 3 times over 30 minutes, delete after last download
  share add /tmp/data.zip --minutes 30 --times 3 --delete-after

  # List active links
  share list

  # Revoke by token prefix
  share rm a3f8c1

  # Revoke by path
  share rm /tmp/report.pdf
`.trim());
}

// ── Subcommand: server ────────────────────────────────────────────────────────

async function cmdServer(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const port = args["port"] !== undefined ? parseInt(String(args["port"])) : DEFAULT_PORT;

  ensureStoreDir();

  const initial = pruneStore(readStore());
  writeStore(initial);
  console.log(`[share server] Starting on port ${String(port)}`);
  console.log(`[share server] Store: ${STORE_PATH}`);
  console.log(`[share server] Base URL: ${baseUrl(port)}`);

  setInterval(() => {
    const pruned = pruneStore(readStore());
    writeStore(pruned);
  }, CLEANUP_INTERVAL_MS);

  Bun.serve({
    port,
    fetch(req) {
      return handleRequest(req);
    },
  });

  console.log(`[share server] Ready`);
}

function handleRequest(req: Request): Response {
  const url = new URL(req.url);

  if (url.pathname === "/health") {
    return new Response("ok", { status: 200 });
  }

  const match = url.pathname.match(/^\/share\/([a-f0-9]{64})$/);
  if (!match || req.method !== "GET") {
    return new Response("Not found", { status: 404, headers: SECURE_HEADERS });
  }

  const token = match[1]!;
  const store = readStore();
  const entry = store[token];

  if (!entry) {
    return new Response("Not found", { status: 404, headers: SECURE_HEADERS });
  }

  const now = Date.now();
  if (entry.expiresAt <= now || entry.usesRemaining <= 0) {
    delete store[token];
    writeStore(store);
    return new Response("Link expired", { status: 410, headers: SECURE_HEADERS });
  }

  if (!isAllowedPath(entry.filePath)) {
    return new Response("Not found", { status: 404, headers: SECURE_HEADERS });
  }

  if (!existsSync(entry.filePath)) {
    delete store[token];
    writeStore(store);
    return new Response("File no longer available", { status: 410, headers: SECURE_HEADERS });
  }

  entry.usesRemaining -= 1;
  const isLastDownload = entry.usesRemaining <= 0;

  if (isLastDownload) {
    delete store[token];
  } else {
    store[token] = entry;
  }
  writeStore(store);

  if (isLastDownload && entry.deleteAfter) {
    try { unlinkSync(entry.filePath); } catch { /* best effort */ }
  }

  const fileName = entry.filePath.split("/").pop() ?? "file";
  const file = Bun.file(entry.filePath);

  return new Response(file, {
    status: 200,
    headers: {
      ...SECURE_HEADERS,
      "Content-Type":        mimeFor(entry.filePath),
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "X-Uses-Remaining":    String(entry.usesRemaining),
    },
  });
}

// ── Subcommand: add ───────────────────────────────────────────────────────────

async function cmdAdd(argv: string[]): Promise<void> {
  const [rawPath, ...rest] = argv;

  if (!rawPath) {
    console.error("Error: share add requires a file path");
    console.error("Usage: share add <path> [--minutes 10] [--times 1] [--delete-after]");
    process.exit(1);
  }

  const args = parseArgs(rest);
  const filePath = resolve(rawPath);
  const minutes = args["minutes"] !== undefined ? parseInt(String(args["minutes"])) : DEFAULT_MINUTES;
  const times   = args["times"]   !== undefined ? parseInt(String(args["times"]))   : DEFAULT_TIMES;
  const deleteAfter = args["delete-after"] === true;
  const maxSize = args["max-size"] !== undefined ? parseInt(String(args["max-size"])) : DEFAULT_MAX_BYTES;
  const port    = args["port"]    !== undefined ? parseInt(String(args["port"]))    : DEFAULT_PORT;

  if (!existsSync(filePath)) {
    console.error(`Error: file not found: ${filePath}`);
    process.exit(1);
  }

  if (!isAllowedPath(filePath)) {
    console.error(`Error: path must be under /data/, /tmp/, or /var/tmp/`);
    process.exit(1);
  }

  const stat = statSync(filePath);
  if (!stat.isFile()) {
    console.error(`Error: not a file: ${filePath}`);
    process.exit(1);
  }

  if (stat.size > maxSize) {
    console.error(`Error: file is ${String(stat.size)} bytes, exceeds max ${String(maxSize)} bytes`);
    process.exit(1);
  }

  if (minutes < 1 || minutes > 60) {
    console.error("Error: --minutes must be between 1 and 60");
    process.exit(1);
  }

  if (times < 1) {
    console.error("Error: --times must be at least 1");
    process.exit(1);
  }

  const healthUrl = `http://localhost:${String(port)}/health`;
  try {
    const res = await fetch(healthUrl);
    if (!res.ok) throw new Error("unhealthy");
  } catch {
    console.error(`Error: share server is not running on port ${String(port)}.`);
    console.error(`Start it first: shell(background: true, command: "bun /app/bin/share server")`);
    process.exit(1);
  }

  ensureStoreDir();

  const token = randomBytes(32).toString("hex");
  const expiresAt = Date.now() + minutes * 60 * 1000;
  const entry: TokenEntry = { filePath, expiresAt, usesRemaining: times, deleteAfter };

  const store = readStore();
  store[token] = entry;
  writeStore(store);

  const url = `${baseUrl(port)}/share/${token}`;
  const usesLabel = times === 1 ? "1 download" : `${String(times)} downloads`;
  const deleteLabel = deleteAfter ? " · delete-after" : "";

  console.log(`\n  ${url}\n`);
  console.log(`  ⏱  ${String(minutes)} min · ${usesLabel}${deleteLabel}`);
  console.log(`  📄 ${filePath}\n`);
}

// ── Subcommand: list ──────────────────────────────────────────────────────────

function cmdList(): void {
  const raw = readStore();
  const store = pruneStore(raw);

  if (Object.keys(store).length !== Object.keys(raw).length) {
    writeStore(store);
  }

  const entries = Object.entries(store);

  if (entries.length === 0) {
    console.log("No active links.");
    return;
  }

  const base = baseUrl(DEFAULT_PORT);

  console.log(`\n  ${"TOKEN".padEnd(12)}  ${"EXPIRES".padEnd(8)}  ${"USES".padEnd(5)}  PATH`);
  console.log(`  ${"─".repeat(70)}`);
  for (const [token, entry] of entries) {
    const short = token.slice(0, 8) + "…";
    const remaining = formatTimeRemaining(entry.expiresAt).padEnd(8);
    const uses = String(entry.usesRemaining).padEnd(5);
    console.log(`  ${short.padEnd(12)}  ${remaining}  ${uses}  ${entry.filePath}`);
  }
  console.log(`\n  ${String(entries.length)} active link(s)`);
  console.log(`  Base URL: ${base}\n`);
}

// ── Subcommand: rm ────────────────────────────────────────────────────────────

function cmdRm(argv: string[]): void {
  const [query] = argv;

  if (!query) {
    console.error("Error: share rm requires a token prefix or file path");
    process.exit(1);
  }

  const store = readStore();
  const removed: string[] = [];

  for (const [token, entry] of Object.entries(store)) {
    const matchesToken = token.startsWith(query);
    const matchesPath  = resolve(query) === entry.filePath || query === entry.filePath;

    if (matchesToken || matchesPath) {
      delete store[token];
      removed.push(token.slice(0, 8) + "…");
    }
  }

  if (removed.length === 0) {
    console.error(`No matching link found for: ${query}`);
    process.exit(1);
  }

  writeStore(store);
  for (const t of removed) {
    console.log(`Revoked: ${t}`);
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

const [subcommand, ...rest] = process.argv.slice(2);

switch (subcommand) {
  case "server":
    await cmdServer(rest);
    break;
  case "add":
    await cmdAdd(rest);
    break;
  case "list":
    cmdList();
    break;
  case "rm":
    cmdRm(rest);
    break;
  case "-h":
  case "--help":
  case "help":
  case undefined:
    printHelp();
    break;
  default:
    console.error(`Unknown subcommand: ${subcommand}`);
    console.error("Run: share -h");
    process.exit(1);
}
