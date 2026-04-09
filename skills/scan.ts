import { readdirSync, readFileSync, existsSync } from "fs";

// /data/skills is scanned first — user skills win on name collision
const SKILL_DIRS = ["/data/skills", "/data/source/skills"];

type Skill = { name: string; description: string; path: string };
const seen = new Set<string>();
const skills: Skill[] = [];

for (const dir of SKILL_DIRS) {
  if (!existsSync(dir)) continue;

  const entries = readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const entry of entries) {
    const skillPath = `${dir}/${entry}/SKILL.md`;
    if (!existsSync(skillPath)) continue;

    const content = readFileSync(skillPath, "utf8");
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) continue;

    const fm = fmMatch[1];
    const nameMatch = fm.match(/^name:\s*(.+)$/m);
    const descMatch = fm.match(/^description:\s*([\s\S]*?)(?=\n\w+:|$)/m);

    const name = nameMatch?.[1]?.trim() ?? entry;
    if (seen.has(name)) continue; // user skill in /data/skills takes priority
    seen.add(name);

    const description = descMatch?.[1]?.replace(/\n\s+/g, " ").trim() ?? "(no description)";
    skills.push({ name, description, path: skillPath });
  }
}

if (skills.length === 0) {
  console.log("No skills found.");
} else {
  console.log("=== Available Skills ===\n");
  for (const skill of skills) {
    console.log(`[${skill.name}]`);
    console.log(`  Path: ${skill.path}`);
    console.log(`  ${skill.description}`);
    console.log();
  }
}
