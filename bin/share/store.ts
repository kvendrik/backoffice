import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";

export const STORE_PATH = process.env["SHARE_STORE_PATH"] ?? "/tmp/sharing/store.json";
export const ALLOWED_PREFIXES = ["/data/", "/tmp/", "/var/tmp/"];

export interface TokenEntry {
  filePath: string;
  expiresAt: number; // Unix ms
  usesRemaining: number;
  deleteAfter: boolean;
}

export type TokenStore = Record<string, TokenEntry>;

export function readStore(): TokenStore {
  if (!existsSync(STORE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(STORE_PATH, "utf8")) as TokenStore;
  } catch {
    return {};
  }
}

/** Atomic write via tmp + rename (safe on Linux). */
export function writeStore(store: TokenStore): void {
  const tmp = STORE_PATH + ".tmp";
  writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
  renameSync(tmp, STORE_PATH);
}

export function pruneStore(store: TokenStore): TokenStore {
  const now = Date.now();
  const pruned: TokenStore = {};
  for (const [token, entry] of Object.entries(store)) {
    if (entry.expiresAt > now && entry.usesRemaining > 0 && existsSync(entry.filePath)) {
      pruned[token] = entry;
    }
  }
  return pruned;
}

export function isAllowedPath(filePath: string): boolean {
  return ALLOWED_PREFIXES.some((p) => filePath.startsWith(p));
}

export function formatTimeRemaining(expiresAt: number): string {
  const secs = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  if (secs < 60) return `${String(secs)}s`;
  if (secs < 3600) return `${String(Math.floor(secs / 60))}m`;
  return `${String(Math.floor(secs / 3600))}h ${String(Math.floor((secs % 3600) / 60))}m`;
}
