import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory()
      ? e.name === "node_modules"
        ? []
        : walk(p)
      : /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)
      ? [p]
      : [];
  });

const declared = (): Set<string> => {
  const text = fs.readFileSync(path.join(here, "../src/errors.ts"), "utf8");
  const body = /export type PluginErrorCode =([^;]*);/.exec(text)![1];
  return new Set([...body.matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]));
};

describe("PluginErrorCode", () => {
  it("lists every code the host and the mock host throw", () => {
    const known = declared();
    const used = new Set<string>();
    for (const dir of [
      "excalidraw-desktop/src/plugins",
      "sdk/api/shared",
      "sdk/api/testing",
    ]) {
      for (const f of walk(path.join(repo, dir))) {
        const text = fs.readFileSync(f, "utf8");
        for (const m of text.matchAll(/PluginApiError\(\s*"([A-Z_]+)"/g)) {
          used.add(m[1]);
        }
      }
    }
    expect(used.size).toBeGreaterThan(8);
    expect([...used].filter((c) => !known.has(c))).toEqual([]);
  });

  it("is documented in reference.md", () => {
    const doc = fs.readFileSync(
      path.join(repo, "sdk/docs/reference.md"),
      "utf8",
    );
    for (const c of declared()) {
      expect(doc, c).toContain(`\`${c}\``);
    }
  });
});
