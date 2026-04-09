/**
 * Persistent cron scheduler using croner.
 *
 * Reads /data/cron.json on startup, creates in-process cron jobs via croner.
 * Re-reads the file periodically to pick up changes without restart.
 *
 * Schedule format (/data/cron.json):
 * [
 *   { "schedule": "0 9 * * *", "command": "bun /app/skills/telegram/scripts/send.ts 'Good morning'" },
 *   { "schedule": "0,30 * * * *", "command": "echo hello" }
 * ]
 */

import { Cron } from "croner";
import { existsSync, readFileSync } from "node:fs";

const SCHEDULE_PATH = "/data/cron.json";
const RELOAD_INTERVAL = 60_000;

interface CronJobDef {
  schedule: string;
  command: string;
}

let activeJobs: Cron[] = [];

function isCronJobDef(j: unknown): j is CronJobDef {
  return (
    j != null &&
    typeof j === "object" &&
    "schedule" in j &&
    typeof (j as CronJobDef).schedule === "string" &&
    "command" in j &&
    typeof (j as CronJobDef).command === "string"
  );
}

function loadJobDefs(): CronJobDef[] {
  if (!existsSync(SCHEDULE_PATH)) return [];
  try {
    const raw: unknown = JSON.parse(readFileSync(SCHEDULE_PATH, "utf8"));
    if (!Array.isArray(raw)) return [];
    return raw.filter(isCronJobDef);
  } catch (e) {
    console.error("[cron] Failed to parse schedule file:", e);
    return [];
  }
}

function fingerprint(defs: CronJobDef[]): string {
  return JSON.stringify(defs);
}

function runCommand(command: string): Promise<void> {
  console.log(`[cron] Running: ${command}`);
  const proc = Bun.spawn(["sh", "-c", command], {
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env },
  });
  return proc.exited.then((code) => {
    if (code !== 0) console.error(`[cron] Exit ${String(code)}: ${command}`);
  });
}

function syncJobs(defs: CronJobDef[]) {
  for (const job of activeJobs) job.stop();
  activeJobs = [];

  for (const def of defs) {
    try {
      const job = new Cron(def.schedule, { protect: true }, async () => {
        try {
          await runCommand(def.command);
        } catch (e) {
          console.error(`[cron] Error running "${def.command}":`, e);
        }
      });
      activeJobs.push(job);
      console.log(`[cron] Scheduled: "${def.schedule}" → ${def.command}`);
    } catch (e) {
      console.error(`[cron] Invalid schedule "${def.schedule}":`, e);
    }
  }
}

let lastFingerprint = "";

function reload() {
  const defs = loadJobDefs();
  const fp = fingerprint(defs);
  if (fp === lastFingerprint) return;
  lastFingerprint = fp;
  console.log(`[cron] Config changed, reloading ${String(defs.length)} job(s)`);
  syncJobs(defs);
}

export function startCron() {
  console.log("[cron] Scheduler started (croner, reloads every 60s)");
  reload();
  setInterval(reload, RELOAD_INTERVAL);
}
