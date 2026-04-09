#!/usr/bin/env bun
/**
 * webhook — Backoffice webhook CLI
 *
 * The webhook HTTP server starts automatically with Backoffice.
 * Use this CLI to manage endpoints:
 *
 *   bun /app/skills/webhook register --secret <s> --cmd <c> [flags]
 *   bun /app/skills/webhook list
 *   bun /app/skills/webhook rm <id>
 *   bun /app/skills/webhook -h
 */

import { randomBytes } from "node:crypto";
import { createConnection } from "node:net";
import { SOCKET_PATH } from "../../src/rpc.js";
import { readRegistrations } from "../../src/webhook.js";
import type { RegStore } from "../../src/webhook.js";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

// ── Constants ─────────────────────────────────────────────────────────────────

const WEBHOOK_PORT      = parseInt(process.env["WEBHOOK_PORT"] ?? "3002");
const REG_DIR           = "/data/webhooks";
const REG_PATH          = `${REG_DIR}/registrations.json`;
const DEFAULT_REPLAY_TTL = 86_400;

// ── Store ─────────────────────────────────────────────────────────────────────

function writeRegistrations(store: RegStore): void {
  if (!existsSync(REG_DIR)) mkdirSync(REG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(REG_PATH, JSON.stringify(store, null, 2), { mode: 0o600 });
}

// ── RPC ───────────────────────────────────────────────────────────────────────

async function rpcCall(method: string, params: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(SOCKET_PATH);
    socket.on("connect", () => {
      socket.write(JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }) + "\n");
    });
    socket.on("data", () => { socket.destroy(); resolve(); });
    socket.on("error", reject);
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function baseUrl(): string {
  const domain = process.env["RAILWAY_PUBLIC_DOMAIN"]?.trim();
  if (domain) return `https://${domain}`;
  return `http://localhost:${String(WEBHOOK_PORT)}`;
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg?.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) { result[key] = next; i++; }
      else result[key] = true;
    }
  }
  return result;
}

// ── Help ──────────────────────────────────────────────────────────────────────

function printHelp(): void {
  console.log(`
webhook — Backoffice webhook CLI

The webhook server starts automatically with Backoffice — no manual server start needed.

USAGE
  bun /app/skills/webhook register [flags]          Register a new endpoint, print the URL
  bun /app/skills/webhook list                      Show registered endpoints
  bun /app/skills/webhook rm <id>                   Unregister endpoint

REGISTER FLAGS (--secret and --cmd are required)
  --secret <str>               HMAC-SHA256 secret (must match sender config)
  --cmd <str>                  Shell command fired on each valid request (payload on stdin as JSON)
  --name <str>                 Optional human label
  --signature-header <n>       Header containing the signature (default: X-Hub-Signature-256)
  --signature-prefix <str>     Prefix to strip before comparing (default: sha256=)
  --signature-encoding <enc>   hex | base64 (default: hex)
  --replay-ttl <seconds>       Replay detection window (default: ${String(DEFAULT_REPLAY_TTL)})

HANDLER STDIN
  { "method": "POST", "headers": { ... }, "body": "<raw body>" }

EXAMPLES
  bun /app/skills/webhook register \\
    --secret mysecret --cmd "bun /data/handle-github.ts" --name "github-push"

  # Shopify (base64)
  bun /app/skills/webhook register \\
    --secret mysecret --cmd "bun /data/handle-shopify.ts" \\
    --signature-header X-Shopify-Hmac-Sha256 --signature-prefix "" --signature-encoding base64
`.trim());
}

// ── Subcommand: register ──────────────────────────────────────────────────────

async function cmdRegister(argv: string[]): Promise<void> {
  const args = parseArgs(argv);

  const secret = typeof args["secret"] === "string" ? args["secret"].trim() : "";
  const cmd    = typeof args["cmd"]    === "string" ? args["cmd"].trim()    : "";
  const name   = typeof args["name"]   === "string" ? args["name"].trim()   : undefined;

  if (!secret) { console.error("Error: --secret is required"); process.exit(1); }
  if (!cmd)    { console.error("Error: --cmd is required");    process.exit(1); }

  const signatureHeader   = typeof args["signature-header"]   === "string" ? args["signature-header"]   : "X-Hub-Signature-256";
  const signaturePrefix   = typeof args["signature-prefix"]   === "string" ? args["signature-prefix"]   : "sha256=";
  const rawEncoding       = typeof args["signature-encoding"] === "string" ? args["signature-encoding"] : "hex";
  const signatureEncoding = rawEncoding === "base64" ? "base64" as const : "hex" as const;
  const replayTtl         = typeof args["replay-ttl"] === "string" ? parseInt(args["replay-ttl"]) : DEFAULT_REPLAY_TTL;

  const id      = randomBytes(32).toString("hex");
  const pattern = `/webhook/${id}`;

  // Register route with the running server via RPC
  try {
    await rpcCall("route.register", { pattern, target: `http://localhost:${String(WEBHOOK_PORT)}` });
  } catch {
    console.error("Error: could not register route — is Backoffice running?");
    process.exit(1);
  }

  const store = readRegistrations();
  store[id] = { id, name, secret, cmd, pattern, createdAt: Date.now(), signatureHeader, signaturePrefix, signatureEncoding, replayTtl };
  writeRegistrations(store);

  const url = `${baseUrl()}${pattern}`;
  console.log(`\n  ${url}\n`);
  console.log(`  🪝  ${name ?? "(unnamed)"}`);
  console.log(`  ⚙️   ${cmd}`);
  console.log(`  🔐  ${signatureHeader} (${signatureEncoding})`);
  console.log(`  ♻️   replay window: ${String(replayTtl)}s\n`);
}

// ── Subcommand: list ──────────────────────────────────────────────────────────

function cmdList(): void {
  const entries = Object.values(readRegistrations());
  if (entries.length === 0) { console.log("No registered endpoints."); return; }

  console.log(`\n  ${"ID".padEnd(10)}  ${"NAME".padEnd(16)}  ${"HEADER".padEnd(28)}  CMD`);
  console.log(`  ${"─".repeat(90)}`);
  for (const reg of entries) {
    console.log(`  ${(reg.id.slice(0, 8) + "…").padEnd(10)}  ${(reg.name ?? "—").padEnd(16)}  ${reg.signatureHeader.padEnd(28)}  ${reg.cmd}`);
  }
  console.log(`\n  ${String(entries.length)} endpoint(s) — ${baseUrl()}\n`);
}

// ── Subcommand: rm ────────────────────────────────────────────────────────────

async function cmdRm(argv: string[]): Promise<void> {
  const [query] = argv;
  if (!query) { console.error("Error: webhook rm requires an id prefix"); process.exit(1); }

  const store   = readRegistrations();
  const removed: string[] = [];

  for (const [id, reg] of Object.entries(store)) {
    if (id.startsWith(query)) {
      try { await rpcCall("route.unregister", { pattern: reg.pattern }); } catch { /* best effort */ }
      delete store[id];
      removed.push(`${id.slice(0, 8)}… (${reg.name ?? reg.cmd})`);
    }
  }

  if (removed.length === 0) { console.error(`No endpoint found matching: ${query}`); process.exit(1); }

  writeRegistrations(store);
  for (const label of removed) console.log(`Removed: ${label}`);
}

// ── Entry point ───────────────────────────────────────────────────────────────

const [subcommand, ...rest] = process.argv.slice(2);

switch (subcommand) {
  case "register": await cmdRegister(rest);  break;
  case "list":     cmdList();                break;
  case "rm":       await cmdRm(rest);        break;
  case "-h": case "--help": case "help": case undefined: printHelp(); break;
  default:
    console.error(`Unknown subcommand: ${subcommand}`);
    console.error("Run: bun /app/skills/webhook -h");
    process.exit(1);
}
