import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Guard (bug utilizer, 2026-10-30): a test in the fast tier never compares elapsed wall-clock
 * time to a fixed threshold. sceneOps.bench and host.bench failed test:fast under load at least
 * four times in one night and leads waved them through by hand. Timing checks live in
 * `*.bench.test.ts` files (left out of the fast tier) or assert CPU time or operation counts.
 * KNOWN lists the files that still do it, to move to bench files (toimprove); never add to it.
 */
const ROOT = resolve(__dirname, "../../..");
const KNOWN = new Set([
  // this guard's own sample text
  "excalidraw-desktop/src/tests/wallclock.guard.test.ts",
  "excalidraw-desktop/src/tabs/historyBytes.test.ts",
  "excalidraw-desktop/src/tests/libraryEdgeCases.test.tsx",
  "excalidraw-desktop/src/tests/treeSort.test.ts",
  "packages/excalidraw/tests/libraryNames.test.tsx",
  "plugins/official/markdown-import/test/layout/budget.test.ts",
  "sdk/examples/word-count/main.test.tsx",
]);

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    if (
      ["node_modules", "dist", "e2e"].includes(name) ||
      name.startsWith(".")
    ) {
      continue;
    }
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      walk(path, out);
    } else if (/\.test\.tsx?$/.test(name) && !/\.bench\.test\./.test(name)) {
      out.push(path);
    }
  }
  return out;
};

/** Names assigned an elapsed time and later asserted below a number. */
export const wallClockThresholds = (text: string): string[] => {
  const names = new Set(
    [
      ...text.matchAll(/(\w+)\s*=\s*(?:performance\.now|Date\.now)\(\)\s*-/g),
    ].map((m) => m[1]),
  );
  return [...names].filter((n) =>
    new RegExp(`expect\\(\\s*${n}\\b[^)]*\\)\\s*\\.toBeLessThan`).test(text),
  );
};

describe("wall-clock guard", () => {
  it("finds the pattern it was written for", () => {
    expect(
      wallClockThresholds(
        "const ms = performance.now() - t0;\nexpect(ms).toBeLessThan(50);",
      ),
    ).toEqual(["ms"]);
    expect(
      wallClockThresholds("const n = ops.length;\nexpect(n).toBeLessThan(5);"),
    ).toEqual([]);
  });

  it("no fast-tier test compares elapsed time to a fixed threshold", () => {
    const files = [
      ...walk(join(ROOT, "excalidraw-desktop/src")),
      ...walk(join(ROOT, "packages")),
      ...walk(join(ROOT, "plugins/official")),
      ...walk(join(ROOT, "sdk")),
    ];
    const offenders = files
      .map((f) => f.slice(ROOT.length + 1))
      .filter(
        (f) =>
          !KNOWN.has(f) &&
          wallClockThresholds(readFileSync(join(ROOT, f), "utf8")).length > 0,
      );
    expect(offenders).toEqual([]);
  });

  it("every known file still needs its entry (no stale entries)", () => {
    const stale = [...KNOWN].filter(
      (f) =>
        wallClockThresholds(readFileSync(join(ROOT, f), "utf8")).length === 0,
    );
    expect(stale).toEqual([]);
  });
});
