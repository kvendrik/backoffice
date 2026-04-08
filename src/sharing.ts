import { randomBytes } from "node:crypto";

const EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const CLEANUP_INTERVAL_MS = 60 * 1000; // check every minute

interface ShareEntry {
  filePath: string;
  filename: string;
  expiresAt: number;
}

const store = new Map<string, ShareEntry>();

// Prune expired tokens every minute
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of store) {
    if (now > entry.expiresAt) {
      store.delete(token);
    }
  }
}, CLEANUP_INTERVAL_MS).unref();

export function registerFile(filePath: string, filename: string): string {
  const token = randomBytes(32).toString("hex");
  store.set(token, {
    filePath,
    filename,
    expiresAt: Date.now() + EXPIRY_MS,
  });
  return token;
}

export function getFile(token: string): ShareEntry | null {
  const entry = store.get(token);
  if (entry === undefined) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(token);
    return null;
  }
  return entry;
}

export function deleteToken(token: string): void {
  store.delete(token);
}

export function remainingMs(token: string): number | null {
  const entry = store.get(token);
  if (entry === undefined) return null;
  return Math.max(0, entry.expiresAt - Date.now());
}
