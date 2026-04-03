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

export function parsePatch(patchText: string): ParsedPatch {
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

  let hunkIdx = 0;
  while (hunkIdx < hunkLines.length) {
    const line = hunkLines[hunkIdx]!;

    if (line.startsWith("@@")) {
      if (currentHunk.length > 0) {
        applyHunk(currentHunk);
        currentHunk = [];
      }
      // Seek originalIndex to the position of the next hunk's first context/removal line.
      // Without this, @@ is purely decorative and all hunks must be contiguous from line 1.
      let peekIdx = hunkIdx + 1;
      while (peekIdx < hunkLines.length && (hunkLines[peekIdx]!.length === 0 || hunkLines[peekIdx]!.startsWith("@@"))) {
        peekIdx++;
      }
      const anchor = hunkLines[peekIdx];
      if (anchor && anchor !== "*** End of File" && (anchor[0] === " " || anchor[0] === "-")) {
        const anchorContent = anchor.slice(1);
        let seekIdx = originalIndex;
        while (seekIdx < originalLines.length && originalLines[seekIdx] !== anchorContent) {
          seekIdx++;
        }
        if (seekIdx < originalLines.length) {
          while (originalIndex < seekIdx) {
            newLines.push(originalLines[originalIndex]!);
            originalIndex++;
          }
        }
      }
      hunkIdx++;
      continue;
    }

    if (line === "*** End of File") break;
    currentHunk.push(line);
    hunkIdx++;
  }

  if (currentHunk.length > 0) applyHunk(currentHunk);

  while (originalIndex < originalLines.length) {
    newLines.push(originalLines[originalIndex] ?? "");
    originalIndex += 1;
  }

  await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, newLines.join("\n"), "utf8");
}

/**
 * Applies a patch to a file using the "*** Begin Patch" format.
 *
 * Syntax:
 *
 *   *** Begin Patch
 *   *** Update File: /absolute/path/to/file
 *   @@ optional hunk label
 *    context line (space prefix — must match file exactly)
 *   -line to remove (minus prefix — must match file exactly)
 *   +line to add (plus prefix)
 *   *** End of File
 *   *** End Patch
 *
 * To create a new file instead of updating one, use:
 *   *** Add File: /absolute/path/to/file
 *
 * Rules:
 * - The file path must be absolute.
 * - Context lines (space-prefixed) and removal lines (minus-prefixed) must
 *   match the file content exactly, character for character.
 * - Multiple hunks are supported — separate them with additional @@ lines.
 * - "*** End of File" is optional. When present in an update patch, it stops
 *   hunk processing early — any remaining hunk lines after it are ignored.
 *   Remaining lines in the original file are always preserved regardless.
 * - Returns the absolute path of the patched file.
 */
export async function applyPatch(patchText: string): Promise<string> {
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
