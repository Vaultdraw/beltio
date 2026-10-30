/**
 * Guard (validator, 2026-10-30 evening, hunter J-8 / toimprove 217): what counts as a `#tag` is
 * decided once, by `tags/grammar.ts findTags` (the port of the index's `search/tags.rs`, one case
 * table). The reading view's chips (`notes/render/obsidian.ts`) and the plugin API's note parse
 * (`sdk/api/shared/markdown.ts`, lower-case keys, hex colours counted) wrote their own pattern and
 * drifted: chips that are not tags, tags that are not chips. A new copy of the pattern fails here.
 * KNOWN: today's copies with the reason; delete a line when the file uses findTags.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../..");
const DIRS = [
  join(ROOT, "src"),
  join(ROOT, "../plugins/official"),
  join(ROOT, "../sdk"),
];
// A `#` followed by a Unicode letter class, or the grammar's body class itself.
const TAG_COPY = [/#\(?\[\\p\{L\}/, /\[\\p\{Alphabetic\}\\p\{N\}_/];
const OWNER = "src/tags/grammar.ts";
const KNOWN: Record<string, string> = {
  // src/notes/render/obsidian.ts (reading-view chips) uses findTags since 2f5a9aaa (toimprove 217).
  "../sdk/api/shared/markdown.ts": "toimprove 233 (plugin API note tags)",
  "src/notes/markdownLang.ts": "toimprove 233 (note editor highlights tags)",
  "src/editor/tags/tagTrigger.ts":
    "the # suggestion trigger: same characters as the grammar, should import them",
};

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (!["node_modules", "dist", "tests", "e2e"].includes(name)) {
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

describe("guard: one tag grammar", () => {
  const copies = DIRS.flatMap((d) => walk(d))
    .filter((f) => {
      const text = readFileSync(f, "utf8");
      return TAG_COPY.some((re) => re.test(text));
    })
    .map((f) => relative(ROOT, f).split("\\").join("/"))
    .filter((f) => f !== OWNER);

  it("no new copy of the tag pattern outside tags/grammar.ts", () => {
    expect(copies.filter((f) => !KNOWN[f])).toEqual([]);
  });
  it("KNOWN lists only copies that still exist (delete fixed ones)", () => {
    expect(Object.keys(KNOWN).filter((f) => !copies.includes(f))).toEqual([]);
  });
  it.fails("no copies left (chips and the plugin parse use findTags)", () => {
    expect(copies).toEqual([]);
  });
});
