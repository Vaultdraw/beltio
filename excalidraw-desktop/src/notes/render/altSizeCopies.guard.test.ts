/**
 * Barrier (validator, 2026-10-30 evening, J-4 / toimprove 211; twins rule in testing.md): the
 * `alt|size` parse of a picture lives once, in `imageSize.ts altAndSize`, pinned by
 * `alt_size_cases.json` for TypeScript and Rust. A copy elsewhere drifts (hydrate.ts read the
 * whole alias as a size, so `caption|300x200` lost both). This guard fails on any other file that
 * writes the size pattern itself. Remove a file from KNOWN_211 when it uses `altAndSize`.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const SIZE_COPY = /\(\\d\+\)\(\?:x\(\\d\+\)\)\?/;
/** The parser and its plugin copy, both pinned by `alt_size_cases.json`. */
const PINNED = [
  "sdk/api/shared/imageSize.ts",
  "plugins/official/markdown-import/src/layout/literalImages.ts",
];
const KNOWN_211: string[] = [
  // hydrate.ts uses altAndSize since toimprove 211 (fixer A); the plugin API's note parse stand-in
  // (sdk/api/shared/markdown.ts) uses it since the API 1.0 audit.
];

const copies = () =>
  execFileSync("git", ["ls-files", "*.ts", "*.tsx"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .filter(
      (f) => f && !PINNED.includes(f) && !/\.test\.tsx?$|node_modules/.test(f),
    )
    .filter((f) => SIZE_COPY.test(readFileSync(join(root, f), "utf8")));

describe("one alt|size parser (altAndSize)", () => {
  it("no new copy of the size pattern outside imageSize.ts", () => {
    expect(copies().filter((f) => !KNOWN_211.includes(f))).toEqual([]);
  });
  it("the page-mode parser uses altAndSize too", () => {
    expect(copies()).toEqual([]);
  });
});
