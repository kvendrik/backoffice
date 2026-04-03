import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod";

export const ENV_PATH = "/data/.env";

let cache: Record<string, string> | null = null;

function parse(src: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of src.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    result[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return result;
}

function serialize(data: Record<string, string>): string {
  return (
    Object.entries(data)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n"
  );
}

function load(): Record<string, string> {
  if (cache !== null) return cache;
  try {
    cache = parse(readFileSync(ENV_PATH, "utf8"));
  } catch {
    cache = {};
  }
  return cache;
}

function save(): void {
  const data = load();
  mkdirSync(dirname(ENV_PATH), { recursive: true });
  writeFileSync(ENV_PATH, serialize(data), { mode: 0o600 });
}

export function getAll(): Record<string, string> {
  return { ...load() };
}

export function register(server: McpServer): void {
  server.registerTool(
    "env_set",
    {
      description:
        "Persist an environment variable. The value is stored on disk and automatically injected into every shell call. Use this for credentials and API keys — values are not returned to the conversation.",
      inputSchema: {
        name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Must be a valid env var name"),
        value: z.string().refine((v) => !v.includes("\n"), "Value must not contain newlines"),
      },
    },
    ({ name, value }) => {
      try {
        const data = load();
        data[name] = value;
        save();
        return {
          content: [{ type: "text" as const, text: `Environment variable "${name}" set.` }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: String(err) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "env_delete",
    {
      description: "Remove a persisted environment variable.",
      inputSchema: {
        name: z.string().describe("The environment variable name to remove"),
      },
    },
    ({ name }) => {
      try {
        const data = load();
        if (!(name in data)) {
          return {
            content: [
              { type: "text" as const, text: `Environment variable "${name}" not found.` },
            ],
            isError: true,
          };
        }
        cache = Object.fromEntries(Object.entries(data).filter(([k]) => k !== name));
        save();
        return {
          content: [{ type: "text" as const, text: `Environment variable "${name}" deleted.` }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: String(err) }],
          isError: true,
        };
      }
    },
  );
}
