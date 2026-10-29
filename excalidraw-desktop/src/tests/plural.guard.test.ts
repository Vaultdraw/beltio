import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { count } from "../../../sdk/api/shared/plural";

/**
 * Guard (test-net TN-10, 2026-10-30): a user message never prints "1 notes". A count followed by
 * a plural noun in a template string must use `count()` (sdk/api/shared/plural.ts) or sit next to
 * an explicit `=== 1` branch, or carry a `// plural-ok: <why>` line above it (a name, not a count).
 * Smoke, perf and test files are not user text.
 */
const ROOT = resolve(__dirname, "../../..");
const NOUNS =
  "notes?|drawings?|files?|pictures?|images?|items?|links?|backlinks?|words?|changes?|elements?|attachments?|pages?|folders?|results?|versions?|parts?|matches?";
const PATTERN = new RegExp(`\\$\\{[^}]+\\} (?:${NOUNS})\\b`);
const GUARDED = /[!=]== ?1\b|count\(|plural\(|> ?1\b|plural-ok/;

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    if (
      ["node_modules", "dist", "smoke", "perf"].includes(name) ||
      name.startsWith(".")
    ) {
      continue;
    }
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      walk(path, out);
    } else if (
      /\.tsx?$/.test(name) &&
      !/\.(test|spec|bench)\.tsx?$/.test(name)
    ) {
      out.push(path);
    }
  }
  return out;
};

describe("plural guard", () => {
  it("count() says 1 note and 2 notes", () => {
    expect(count(1, "note")).toBe("1 note");
    expect(count(0, "note")).toBe("0 notes");
    expect(count(1200, "match", "matches")).toBe("1,200 matches");
  });

  it("no message prints a count with a fixed plural noun", () => {
    const files = [
      ...walk(join(ROOT, "excalidraw-desktop/src")),
      ...walk(join(ROOT, "plugins/official")),
    ].filter((f) => !/\/test\//.test(f));
    const offenders: string[] = [];
    for (const f of files) {
      const lines = readFileSync(f, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (!PATTERN.test(line) || /^\s*(\/\/|\*)|log\.|console\./.test(line)) {
          return;
        }
        const near = lines.slice(Math.max(0, i - 3), i + 2).join("\n");
        if (!GUARDED.test(near)) {
          offenders.push(`${relative(ROOT, f)}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
