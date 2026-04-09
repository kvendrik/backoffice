/**
 * process-tracker.ts — Tracked process spawning for cron and webhook jobs.
 *
 * Wraps Bun.spawn with:
 *   - Timeout + SIGKILL if exceeded
 *   - Stderr capture to a rolling log file (/data/logs/<key>/stderr.log, max 100 KB)
 *   - Execution record appended to /data/logs/<key>/exec.jsonl after each run
 *
 * Log paths are derived from the caller-supplied `key` string, which is
 * sanitised to be filesystem-safe (slashes allowed for namespacing, e.g.
 * "cron/morning-digest" or "webhook/a3f8c1").
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";

// ── Constants ─────────────────────────────────────────────────────────────────

const LOG_ROOT          = "/data/logs";
const DEFAULT_TIMEOUT   = 30_000;   // ms
const STDERR_MAX_BYTES  = 100_000;  // 100 KB rolling cap

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SpawnOptions {
  /** Filesystem-safe key used to derive log paths, e.g. "cron/backup" */
  key: string;
  /** Milliseconds before the process is killed. Default: 30 000 */
  timeoutMs?: number;
  /** Extra environment variables merged onto process.env */
  env?: Record<string, string>;
}

export interface ExecRecord {
  startedAt:  number;
  endedAt:    number;
  durationMs: number;
  exitCode:   number | null;
  timedOut:   boolean;
  command:    string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeKey(key: string): string {
  // Allow word chars, hyphens, and forward slashes (for namespacing).
  // Replace anything else with an underscore.
  return key.replace(/[^\w\-/]/g, "_");
}

function logDir(key: string): string {
  return `${LOG_ROOT}/${safeKey(key)}`;
}

function stderrPath(key: string): string {
  return `${logDir(key)}/stderr.log`;
}

function execLogPath(key: string): string {
  return `${logDir(key)}/exec.jsonl`;
}

function ensureLogDir(key: string): void {
  const dir = logDir(key);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
}

/**
 * Append stderr output to the rolling log file.
 * If the file exceeds STDERR_MAX_BYTES, the oldest half is dropped.
 */
function appendStderr(key: string, data: string): void {
  if (data === "") return;
  ensureLogDir(key);
  const path = stderrPath(key);

  let existing = "";
  try { existing = readFileSync(path, "utf8"); } catch { /* new file */ }

  let combined = existing + data;
  if (Buffer.byteLength(combined) > STDERR_MAX_BYTES) {
    // Drop the first half — keep the most recent output
    combined = combined.slice(Math.floor(combined.length / 2));
  }

  writeFileSync(path, combined, { mode: 0o600 });
}

function appendExecRecord(key: string, record: ExecRecord): void {
  ensureLogDir(key);
  appendFileSync(execLogPath(key), JSON.stringify(record) + "\n", { mode: 0o600 });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Spawn a shell command with timeout, stderr logging, and execution tracking.
 * Returns a promise that resolves once the process exits or is killed.
 */
export async function spawnTracked(command: string, opts: SpawnOptions): Promise<void> {
  const { key, timeoutMs = DEFAULT_TIMEOUT, env } = opts;

  console.log(`[${key}] Running: ${command}`);
  const startedAt = Date.now();

  const proc = Bun.spawn(["sh", "-c", command], {
    stdout: "inherit",
    stderr: "pipe",
    env: { ...process.env, ...env },
  });

  // Drain stderr asynchronously into the rolling log
  const stderrDone = (async () => {
    const reader = proc.stderr.getReader();
    const decoder = new TextDecoder();
    let result = await reader.read();
    while (!result.done) {
      const chunk = decoder.decode(result.value);
      process.stderr.write(chunk);           // still surface in Railway logs
      appendStderr(key, chunk);
      result = await reader.read();
    }
  })();

  // Race process exit against timeout
  let timedOut = false;
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    proc.kill();
    console.error(`[${key}] Timed out after ${String(timeoutMs)}ms — killed`);
  }, timeoutMs);

  const exitCode = await proc.exited;
  clearTimeout(timeoutHandle);
  await stderrDone;

  const endedAt = Date.now();

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (timedOut) {
    // already logged at kill time
  } else if (exitCode !== 0) {
    console.error(`[${key}] Exit ${String(exitCode)}: ${command}`);
  }

  appendExecRecord(key, {
    startedAt,
    endedAt,
    durationMs: endedAt - startedAt,
    exitCode,
    timedOut,
    command,
  });
}

/**
 * Read the execution log for a given key.
 * Returns records newest-first. Returns [] if no log exists.
 */
export function readExecLog(key: string, limit = 20): ExecRecord[] {
  const path = execLogPath(key);
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean);
  return lines
    .slice(-limit)
    .reverse()
    .map((l) => JSON.parse(l) as ExecRecord);
}

/**
 * Read the stderr log for a given key.
 * Returns empty string if no log exists.
 */
export function readStderrLog(key: string): string {
  const path = stderrPath(key);
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8");
}

/**
 * List all keys that have log directories under /data/logs/.
 */
export function listTrackedKeys(): string[] {
  if (!existsSync(LOG_ROOT)) return [];
  // Read one level deep — keys like "cron/backup" become "cron/backup"
  const result: string[] = [];
  const top = Bun.spawnSync(["find", LOG_ROOT, "-name", "exec.jsonl"]).stdout.toString();
  for (const line of top.split("\n").filter(Boolean)) {
    const rel = line.slice(LOG_ROOT.length + 1).replace("/exec.jsonl", "");
    result.push(rel);
  }
  return result;
}
