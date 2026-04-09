/**
 * Cron job manager — add, remove, list jobs in /data/cron.json
 * with validation and clear error messages.
 *
 * Usage:
 *   bun manage.ts list
 *   bun manage.ts add "<schedule>" "<command>"
 *   bun manage.ts remove <index>
 */

import { Cron } from "croner";

const FILE = "/data/cron.json";
const file = Bun.file(FILE);

type Job = { schedule: string; command: string };

async function loadJobs(): Promise<Job[]> {
  if (!(await file.exists())) return [];
  try {
    const raw = await file.json();
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (j: any) =>
        j != null &&
        typeof j === "object" &&
        typeof j.schedule === "string" &&
        typeof j.command === "string"
    );
  } catch {
    return [];
  }
}

async function saveJobs(jobs: Job[]) {
  await Bun.write(FILE, JSON.stringify(jobs, null, 2) + "\n");
}

function validateSchedule(schedule: string): string | null {
  try {
    const job = new Cron(schedule);
    const next = job.nextRun();
    job.stop();
    if (!next) return `Schedule "${schedule}" will never fire.`;
    return null;
  } catch (e: any) {
    return `Invalid cron expression "${schedule}": ${e.message ?? e}`;
  }
}

const [cmd, ...args] = process.argv.slice(2);

if (!cmd || cmd === "list") {
  const jobs = await loadJobs();
  if (jobs.length === 0) {
    console.log("No cron jobs configured.");
    console.log(`Add one with: bun ${import.meta.dir}/manage.ts add "0 9 * * *" "echo hello"`);
  } else {
    console.log(`${jobs.length} cron job(s):\n`);
    for (let i = 0; i < jobs.length; i++) {
      const j = jobs[i]!;
      let next: string;
      try {
        const c = new Cron(j.schedule);
        next = c.nextRun()?.toISOString() ?? "never";
        c.stop();
      } catch {
        next = "invalid schedule";
      }
      console.log(`  [${i}] ${j.schedule}  →  ${j.command}`);
      console.log(`      next: ${next}`);
    }
  }
  console.log("\nChanges are picked up automatically within 60s.");
} else if (cmd === "add") {
  const schedule = args[0];
  const command = args[1];

  if (!schedule || !command) {
    console.error("Error: Missing arguments.");
    console.error(`Usage: bun ${import.meta.dir}/manage.ts add "<schedule>" "<command>"`);
    console.error(`Example: bun ${import.meta.dir}/manage.ts add "0 9 * * *" "echo good morning"`);
    process.exit(1);
  }

  const err = validateSchedule(schedule);
  if (err) {
    console.error(`Error: ${err}`);
    console.error("\nCron format: minute hour day-of-month month day-of-week");
    console.error("Examples: '0 9 * * *' (daily 9am), '*/15 * * * *' (every 15min), '0 9 * * 1-5' (weekdays 9am)");
    process.exit(1);
  }

  const jobs = await loadJobs();
  jobs.push({ schedule, command });
  await saveJobs(jobs);

  const c = new Cron(schedule);
  console.log(`Added job [${jobs.length - 1}]: ${schedule} → ${command}`);
  console.log(`Next run: ${c.nextRun()?.toISOString()}`);
  console.log(`Total jobs: ${jobs.length}. Will be picked up within 60s.`);
  c.stop();
} else if (cmd === "remove") {
  const idx = parseInt(args[0] ?? "", 10);
  const jobs = await loadJobs();

  if (isNaN(idx) || idx < 0 || idx >= jobs.length) {
    console.error(`Error: Invalid index "${args[0] ?? ""}".`);
    if (jobs.length === 0) {
      console.error("There are no jobs to remove.");
    } else {
      console.error(`Valid range: 0–${jobs.length - 1}. Run 'list' to see current jobs.`);
    }
    process.exit(1);
  }

  const removed = jobs.splice(idx, 1)[0]!;
  await saveJobs(jobs);
  console.log(`Removed job [${idx}]: ${removed.schedule} → ${removed.command}`);
  console.log(`Remaining jobs: ${jobs.length}. Will be picked up within 60s.`);
} else {
  console.error(`Unknown command: "${cmd}"`);
  console.error("Available commands: list, add, remove");
  process.exit(1);
}
