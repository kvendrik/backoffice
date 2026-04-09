import { readFileSync } from "fs";

const LOG_PATH = "/data/log.jsonl";

const lines = readFileSync(LOG_PATH, "utf8").trim().split("\n");
const entries = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

// Pair tool_calls with their results
const callMap: Record<string, { toolName: string; args: any }> = {};
for (const e of entries) {
  if (e.type === "tool_call") {
    callMap[e.callId] = { toolName: e.call?.toolName, args: e.call?.args };
  }
}

// Extract failures with the originating call
type Failure = {
  callId: string;
  timestamp: string;
  text: string;
  toolName: string;
  args: any;
};

const failures: Failure[] = [];

for (const entry of entries) {
  if (entry.type !== "tool_result") continue;
  const text = entry.result?.content?.[0]?.text ?? "";
  const isError =
    entry.result?.isError === true ||
    /exit code: [^0]/.test(text) ||
    /\berror\b|\bpermission denied\b|\bnot found\b|\bEACCES\b|\bENOENT\b/i.test(text);
  if (isError) {
    const call = callMap[entry.callId] ?? { toolName: "unknown", args: {} };
    failures.push({
      callId: entry.callId,
      timestamp: entry.timestamp,
      text,
      toolName: call.toolName,
      args: call.args,
    });
  }
}

// Pattern definitions: [regex, label, reproduction command generator]
type PatternDef = [RegExp, string, (f: Failure) => string];

const patterns: PatternDef[] = [
  [
    /Module not found/i,
    "Missing module (wrong path or not installed)",
    (f) => {
      const cmd = f.args?.command ?? "";
      const match = cmd.match(/bun run ([^\s]+)/);
      return match ? `bun run ${match[1]}` : `bun run /data/node_modules/@kvendrik/strava/src/index.ts activities -n 1`;
    },
  ],
  [
    /EACCES|Permission denied/i,
    "Permission denied (wrong directory)",
    (f) => {
      const cmd = f.args?.command ?? "";
      // Extract the offending path
      const pathMatch = f.text.match(/opening "([^"]+)"|directory '([^']+)'/);
      const path = pathMatch?.[1] ?? pathMatch?.[2] ?? "/app/package.json";
      return `ls -la ${path.split("/").slice(0, -1).join("/")} 2>&1 || echo "not accessible"`;
    },
  ],
  [
    /ENOENT|no such file|cannot access/i,
    "File or directory not found",
    (f) => {
      const pathMatch = f.text.match(/['"](\/[^'"]+)['"]/);
      const path = pathMatch?.[1] ?? "/data";
      return `ls ${path} 2>&1`;
    },
  ],
  [
    /cannot create directory/i,
    "Directory creation blocked (read-only path)",
    (f) => {
      const pathMatch = f.text.match(/directory '([^']+)'/);
      const path = pathMatch?.[1] ?? "/root";
      return `mkdir -p ${path} 2>&1`;
    },
  ],
  [
    /token.*expired|refresh.*fail|auth.*fail/i,
    "Auth token expired or invalid",
    () => `bun run /data/node_modules/@kvendrik/strava/src/index.ts refresh 2>&1`,
  ],
  [
    /timeout/i,
    "Command timeout",
    (f) => {
      const cmd = (f.args?.command ?? "").slice(0, 100);
      return cmd || "echo 'timeout reproduction requires original command'";
    },
  ],
  [
    /Context mismatch/i,
    "Memory patch context mismatch (stale patch target)",
    () => `head -5 /data/MEMORY.md`,
  ],
];

// Categorize failures
type Category = {
  count: number;
  examples: { text: string; reproduction: string }[];
};
const categories: Record<string, Category> = {};

for (const failure of failures) {
  let matched = false;
  for (const [regex, label, repro] of patterns) {
    if (regex.test(failure.text)) {
      if (!categories[label]) categories[label] = { count: 0, examples: [] };
      categories[label].count++;
      if (categories[label].examples.length < 2) {
        categories[label].examples.push({
          text: failure.text.replace(/\n/g, " ").slice(0, 180),
          reproduction: repro(failure),
        });
      }
      matched = true;
      break;
    }
  }
  if (!matched) {
    const label = "Uncategorized error";
    if (!categories[label]) categories[label] = { count: 0, examples: [] };
    categories[label].count++;
    if (categories[label].examples.length < 2) {
      categories[label].examples.push({
        text: failure.text.replace(/\n/g, " ").slice(0, 180),
        reproduction: `# Inspect originating call: ${failure.toolName}(${JSON.stringify(failure.args).slice(0, 80)})`,
      });
    }
  }
}

// Sort by frequency
const sorted = Object.entries(categories).sort((a, b) => b[1].count - a[1].count);

console.log(`\n=== Backoffice Self-Improvement Analysis ===`);
console.log(`Total log entries : ${entries.length}`);
console.log(`Total failures    : ${failures.length}`);
console.log(`\n--- Failure patterns (ranked by frequency) ---\n`);

for (const [label, { count, examples }] of sorted) {
  console.log(`[${count}x] ${label}`);
  for (const { text, reproduction } of examples) {
    console.log(`  Error   : ${text.slice(0, 150)}`);
    console.log(`  Reproduce: ${reproduction}`);
  }
  console.log();
}

console.log("--- Auto-research loop ---");
console.log("For each pattern above (top-down):");
console.log("  1. Run the Reproduce command — confirm error still occurs");
console.log("  2. Implement fix (memory | script | code)");
console.log("  3. Re-run Reproduce command — confirm error is gone");
console.log("  4. Append result to /data/IMPROVEMENT_LOG.md");
