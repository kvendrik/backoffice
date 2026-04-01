import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod";

export function register(server: McpServer): void {
  server.registerTool(
    "patch_file",
    {
      description:
        'Apply a line-based patch to a single file. Uses the "*** Begin Patch" format with one "*** Add File" or "*** Update File" section. The file path inside the patch must be absolute.',
      inputSchema: {
        patch: z.string().describe('Patch string in "*** Begin Patch" format for a single file.'),
      },
    },
    async ({ patch }) => {
      try {
        const filePath = await applyPatch(patch);
        return {
          content: [
            {
              type: "text" as const,
              text: `Patch applied to ${filePath}`,
            },
          ],
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

type PatchOperation = "add" | "update";

interface ParsedPatch {
  operation: PatchOperation;
  filePath: string;
  lines: string[];
}

function parsePatch(patchText: string): ParsedPatch {
  const lines = patchText.replace(/\r\n/g, "\n").split("\n");
  if (lines.length < 3) {
    throw new Error("Patch must contain at least a begin line, header, and end line.");
  }

  const beginLine = lines[0]?.trim();
  if (beginLine !== "*** Begin Patch") {
    throw new Error('Patch must start with "*** Begin Patch".');
  }

  const headerLine = lines[1] ?? "";
  const addPrefix = "*** Add File: ";
  const updatePrefix = "*** Update File: ";

  let operation: PatchOperation;
  let filePath: string;

  if (headerLine.startsWith(addPrefix)) {
    operation = "add";
    filePath = headerLine.slice(addPrefix.length).trim();
  } else if (headerLine.startsWith(updatePrefix)) {
    operation = "update";
    filePath = headerLine.slice(updatePrefix.length).trim();
  } else {
    throw new Error('Second line must be "*** Add File: <path>" or "*** Update File: <path>".');
  }

  if (filePath.length === 0) {
    throw new Error("File path in patch header is empty.");
  }

  const endIndex = lines.lastIndexOf("*** End Patch");
  if (endIndex === -1) {
    throw new Error('Patch must end with "*** End Patch".');
  }

  return { operation, filePath, lines: lines.slice(2, endIndex) };
}

async function applyAdd(filePath: string, hunkLines: string[]): Promise<void> {
  const newLines: string[] = [];
  for (const rawLine of hunkLines) {
    if (rawLine.length === 0 || rawLine.startsWith("@@") || rawLine === "*** End of File") {
      continue;
    }
    if (rawLine.startsWith("+")) {
      newLines.push(rawLine.slice(1));
    }
  }

  const resolved = resolve(filePath);
  await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, newLines.join("\n"), "utf8");
}

async function applyUpdate(filePath: string, hunkLines: string[]): Promise<void> {
  const resolved = resolve(filePath);
  const originalText = await readFile(resolved, "utf8").catch((err: unknown) => {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new Error(`Cannot update non-existent file: ${resolved}`);
    }
    throw err;
  });

  const originalLines = originalText.replace(/\r\n/g, "\n").split("\n");
  const newLines: string[] = [];
  let originalIndex = 0;

  const applyHunk = (body: string[]): void => {
    for (const rawLine of body) {
      if (rawLine.length === 0) continue;

      const marker = rawLine[0];
      const content = rawLine.slice(1);

      if (marker === " ") {
        const orig = originalLines[originalIndex];
        if (orig !== content) {
          throw new Error(
            `Context mismatch at line ${String(originalIndex + 1)}.\nExpected: "${orig ?? ""}"\nGot:      "${content}"`,
          );
        }
        newLines.push(orig);
        originalIndex += 1;
      } else if (marker === "-") {
        const orig = originalLines[originalIndex];
        if (orig !== content) {
          throw new Error(
            `Removal mismatch at line ${String(originalIndex + 1)}.\nExpected: "${orig ?? ""}"\nGot:      "${content}"`,
          );
        }
        originalIndex += 1;
      } else if (marker === "+") {
        newLines.push(content);
      }
    }
  };

  let currentHunk: string[] = [];

  for (const line of hunkLines) {
    if (line.startsWith("@@")) {
      if (currentHunk.length > 0) {
        applyHunk(currentHunk);
        currentHunk = [];
      }
      continue;
    }
    if (line === "*** End of File") break;
    currentHunk.push(line);
  }

  if (currentHunk.length > 0) applyHunk(currentHunk);

  while (originalIndex < originalLines.length) {
    newLines.push(originalLines[originalIndex] ?? "");
    originalIndex += 1;
  }

  await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, newLines.join("\n"), "utf8");
}

async function applyPatch(patchText: string): Promise<string> {
  const parsed = parsePatch(patchText);

  if (!parsed.filePath.startsWith("/")) {
    throw new Error(`Patch file path must be absolute. Got: "${parsed.filePath}"`);
  }

  if (parsed.operation === "update") {
    await applyUpdate(parsed.filePath, parsed.lines);
  } else {
    await applyAdd(parsed.filePath, parsed.lines);
  }

  return parsed.filePath;
}
