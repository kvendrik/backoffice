/**
 * Persistent webhook server.
 *
 * Started automatically by src/index.ts alongside cron.
 * Reads /data/webhooks/registrations.json on startup, registers each
 * endpoint's route directly into routeRegistry, and starts an HTTP server
 * that verifies HMAC signatures and fires the configured --cmd on valid requests.
 *
 * The skills/webhook CLI manages registrations via the Unix socket RPC
 * (route.register / route.unregister), same as the share skill.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { routeRegistry } from "./rpc.js";

const WEBHOOK_PORT   = parseInt(process.env["WEBHOOK_PORT"] ?? "3002");
const REG_PATH       = "/data/webhooks/registrations.json";
const SEEN_PATH      = "/tmp/webhooks/seen.json";
const MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_REPLAY_TTL = 86_400;

const SECURE_HEADERS = {
  "Cache-Control":          "no-store",
  "Referrer-Policy":        "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Registration {
  id: string;
  name?: string;
  secret: string;
  cmd: string;
  pattern: string;
  createdAt: number;
  signatureHeader: string;
  signaturePrefix: string;
  signatureEncoding: "hex" | "base64";
  replayTtl: number;
}

export type RegStore  = Record<string, Registration>;
type SeenStore = Record<string, number>;

// ── Store helpers ─────────────────────────────────────────────────────────────

function readJson<T>(path: string, fallback: T): T {
  try { return JSON.parse(readFileSync(path, "utf8")) as T; }
  catch { return fallback; }
}

function writeJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2), { mode: 0o600 });
}

export function readRegistrations(): RegStore {
  return readJson<RegStore>(REG_PATH, {});
}

function readSeen(): SeenStore  { return readJson<SeenStore>(SEEN_PATH, {}); }

function writeSeen(s: SeenStore): void {
  mkdirSync("/tmp/webhooks", { recursive: true });
  writeJson(SEEN_PATH, s);
}

function pruneSeen(store: SeenStore, ttlSeconds: number): SeenStore {
  const cutoff = Date.now() - ttlSeconds * 1000;
  return Object.fromEntries(Object.entries(store).filter(([, ts]) => ts > cutoff));
}

// ── HMAC verification ─────────────────────────────────────────────────────────

function verifyHmac(
  body: Buffer,
  secret: string,
  presented: string | null,
  prefix: string,
  encoding: "hex" | "base64",
): boolean {
  if (!presented) return false;
  const stripped = prefix
    ? (presented.startsWith(prefix) ? presented.slice(prefix.length) : null)
    : presented;
  if (stripped === null) return false;
  const expected = createHmac("sha256", secret).update(body).digest(encoding);
  try {
    const a = Buffer.from(stripped, encoding);
    const b = Buffer.from(expected, encoding);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch { return false; }
}

// ── Request handler ───────────────────────────────────────────────────────────

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);

  if (url.pathname === "/health") return new Response("ok", { status: 200 });

  const match = url.pathname.match(/^\/webhook\/([a-f0-9]{64})$/);
  if (!match) return new Response("Not found", { status: 404, headers: SECURE_HEADERS });

  const id  = match[1]!;
  const reg = readRegistrations()[id];
  if (!reg) return new Response("Not found", { status: 404, headers: SECURE_HEADERS });

  // Read body (enforce size limit)
  let bodyBuf: Buffer;
  try {
    const raw = await req.arrayBuffer();
    if (raw.byteLength > MAX_BODY_BYTES)
      return new Response("Payload too large", { status: 413, headers: SECURE_HEADERS });
    bodyBuf = Buffer.from(raw);
  } catch {
    return new Response("Bad request", { status: 400, headers: SECURE_HEADERS });
  }

  // HMAC verification
  const sig = req.headers.get(reg.signatureHeader);
  if (!verifyHmac(bodyBuf, reg.secret, sig, reg.signaturePrefix, reg.signatureEncoding)) {
    console.warn(`[webhook] HMAC failed — endpoint ${id.slice(0, 8)}`);
    return new Response("Unauthorized", { status: 401, headers: SECURE_HEADERS });
  }

  // Replay detection
  const seen = pruneSeen(readSeen(), reg.replayTtl ?? DEFAULT_REPLAY_TTL);
  if (seen[sig!] !== undefined) {
    console.warn(`[webhook] Replay detected — endpoint ${id.slice(0, 8)}`);
    return new Response("Conflict", { status: 409, headers: SECURE_HEADERS });
  }
  seen[sig!] = Date.now();
  writeSeen(seen);

  // Build stdin payload and fire handler
  const headersObj: Record<string, string> = {};
  req.headers.forEach((v, k) => { headersObj[k] = v; });
  const payload = JSON.stringify({ method: req.method, headers: headersObj, body: bodyBuf.toString("utf8") });

  const proc = Bun.spawn(["sh", "-c", reg.cmd], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  proc.stdin.write(payload);
  proc.stdin.end();
  proc.exited.then((code) => {
    if (code !== 0) console.error(`[webhook] Handler for ${id.slice(0, 8)} exited ${String(code)}`);
  }).catch(() => {});

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...SECURE_HEADERS, "Content-Type": "application/json" },
  });
}

// ── Public entry point ────────────────────────────────────────────────────────

export function startWebhookServer(): void {
  const regs = readRegistrations();
  const count = Object.keys(regs).length;

  // Register all persisted endpoints directly into routeRegistry
  for (const reg of Object.values(regs)) {
    routeRegistry.set(reg.pattern, `http://localhost:${String(WEBHOOK_PORT)}`);
  }

  if (count > 0) {
    console.log(`[webhook] Restored ${String(count)} endpoint(s)`);
  }

  Bun.serve({ port: WEBHOOK_PORT, fetch: handleRequest });
  console.log(`[webhook] Server started on port ${String(WEBHOOK_PORT)}`);
}
