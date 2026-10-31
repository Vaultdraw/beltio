/**
 * Guard (family hunter shell, 2026-10-31): "a style variable the app's own CSS or TypeScript reads
 * is defined somewhere, or the read has a fallback". `var(--vault-sel-strong)` with no definition
 * is an invisible border or a transparent background, in one theme or all, and no unit test sees
 * it. Scans the desktop app and the official plugins (not the Excalidraw package, which keeps its
 * own variables). A variable counts as defined when `--name:` appears in a style sheet, or its name
 * is a string literal passed to `setProperty` or listed in the theme token table.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const DESKTOP = join(__dirname, "..", "..");
const files = execFileSync("git", ["ls-files", "src", "../plugins/official"], {
  cwd: DESKTOP,
  encoding: "utf8",
})
  .split("\n")
  .filter(
    (f) =>
      /\.(css|tsx?)$/.test(f) &&
      !/\.(test|spec)\.|\/tests?\/|\/e2e\/|\.d\.ts/.test(f),
  );

/** Variables the app reads that something outside this scan provides, with who. */
const PROVIDED_ELSEWHERE: Record<string, string> = {
  "--sidebar-border": "set by the Excalidraw package on its sidebar",
};

const used = new Map<string, string[]>();
const defined = new Set<string>();
for (const f of files) {
  // Comments are prose ("defined as `var(--other)`"), not reads.
  const text = readFileSync(join(DESKTOP, f), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*(\/\/|\*).*$/gm, "");
  for (const m of text.matchAll(/var\(\s*(--[\w-]+)\s*(,)?/g)) {
    if (!m[2]) {
      used.set(m[1], [...(used.get(m[1]) ?? []), f]);
    }
  }
  for (const m of text.matchAll(/(--[\w-]+)\s*:/g)) {
    defined.add(m[1]);
  }
  for (const m of text.matchAll(/["'`](--[\w-]+)["'`]/g)) {
    defined.add(m[1]);
  }
}

describe("guard: every style variable the app reads without a fallback is defined", () => {
  it("sanity: the scan sees the variables", () => {
    expect(used.size).toBeGreaterThan(50);
    expect(defined.size).toBeGreaterThan(100);
  });
  it("no read of an undefined variable", () => {
    const missing = [...used.entries()]
      .filter(([name]) => !defined.has(name) && !PROVIDED_ELSEWHERE[name])
      .map(([name, at]) => `${name} (${at[0]})`);
    expect(missing).toEqual([]);
  });
});
