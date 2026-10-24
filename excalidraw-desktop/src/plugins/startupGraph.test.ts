import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

// Static-import graph (dynamic import() excluded) from the startup entries
// must not reach the plugin host or shared-module exposure.
const STATIC =
  /(?:^|\n)\s*(?:import|export)\s+(?!type\b)[^;'"]*?from\s+["'](\.[^"']+)["']|(?:^|\n)\s*import\s+["'](\.[^"']+)["']/g;

const resolveFile = (from: string, spec: string): string | null => {
  const base = resolve(dirname(from), spec);
  for (const c of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ]) {
    try {
      if (readFileSync(c, "utf8") !== undefined && /\.(tsx?)$/.test(c)) {
        return c;
      }
    } catch {
      /* try next */
    }
  }
  return null;
};

const graph = (entry: string): Set<string> => {
  const seen = new Set<string>();
  const walk = (f: string) => {
    if (seen.has(f)) {
      return;
    }
    seen.add(f);
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(STATIC)) {
      const next = resolveFile(f, (m[1] ?? m[2])!);
      if (next) {
        walk(next);
      }
    }
  };
  walk(entry);
  return seen;
};

describe("startup import graph", () => {
  it.each([
    "../main.tsx",
    "../VaultApp.tsx",
    "../components/settings/SettingsModal.tsx",
  ])("%s statically imports no plugin host/shared code", (entry) => {
    const files = [...graph(resolve(__dirname, entry))];
    expect(files.length).toBeGreaterThan(20);
    const bad = files.filter(
      (f) =>
        /\/src\/plugins\/(host|shared)\//.test(f) ||
        /\/importerMapAdmin\.ts$/.test(f),
    );
    expect(bad).toEqual([]);
  });
});
