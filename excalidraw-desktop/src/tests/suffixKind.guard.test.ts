import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Guard (validator, 2026-10-30, hunter F-7 and F-9): the kind of a file comes from `fileKind`
 * (`vault/fileKind.ts`), never from a hand-written suffix test. Suffix tests drifted twice:
 * `.endsWith(".md")` took an Obsidian drawing (`Idea.excalidraw.md`) for a note (the tab stopped
 * following an outside rename), and case-sensitive `.endsWith(".excalidraw")` mishandled
 * `Plan.EXCALIDRAW` (Duplicate, inline New drawing, plugin file calls).
 *
 * A new `endsWith(".md" | ".excalidraw" | ".markdown")` outside fileKind.ts fails here: use
 * `fileKind`, `hasDrawingExt` or `isNotePath`. KNOWN lists today's places with how many each file
 * has; lower the count (or delete the line) when one is fixed.
 */
const KNOWN: Record<string, { count: number; why: string }> = {
  "notes/FakeNoteFiles.ts": {
    count: 2,
    why: "browser stand-in, lower-cased, excludes .excalidraw.md",
  },
  "perf/leakScenario.ts": { count: 1, why: "perf harness, generated names" },
  "perf/typicalScenarios.ts": {
    count: 1,
    why: "perf harness, generated names",
  },
  "plugins/host/pagesContext.ts": { count: 1, why: "lower-cased" },
  "vault/treeStore.ts": {
    count: 2,
    why: "lower-cased",
  },
};

const SRC = join(__dirname, "..");
const PATTERN =
  /endsWith\(\s*["'`]\.(?:md|markdown|excalidraw|excalidraw\.md)["'`]/g;

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "tests" && name !== "node_modules") {
        walk(p, out);
      }
    } else if (
      /\.(ts|tsx)$/.test(name) &&
      !/\.(test|spec|bench)\.tsx?$/.test(name)
    ) {
      out.push(p);
    }
  }
  return out;
};

describe("guard: a file's kind comes from fileKind, not a suffix test", () => {
  const found: Record<string, number> = {};
  for (const file of walk(SRC)) {
    const rel = relative(SRC, file).split("\\").join("/");
    if (rel === "vault/fileKind.ts") {
      continue;
    }
    const n = (readFileSync(file, "utf8").match(PATTERN) ?? []).length;
    if (n) {
      found[rel] = n;
    }
  }

  it("no new suffix tests outside fileKind.ts", () => {
    const extra = Object.entries(found)
      .filter(([f, n]) => n > (KNOWN[f]?.count ?? 0))
      .map(([f, n]) => `${f}: ${n}`);
    expect(extra, "use fileKind / hasDrawingExt / isNotePath").toEqual([]);
  });

  it("KNOWN has no stale counts (lower them when a place is fixed)", () => {
    const stale = Object.entries(KNOWN)
      .filter(([f, k]) => (found[f] ?? 0) < k.count)
      .map(([f, k]) => `${f}: known ${k.count}, found ${found[f] ?? 0}`);
    expect(stale).toEqual([]);
  });
});
