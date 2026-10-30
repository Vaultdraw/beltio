/**
 * Barrier (validator, 2026-10-30, V-3 / toimprove 202): the task map trusts that the reading
 * view's block tokens cover the note exactly, line for line. Any renderer extension that cuts a
 * paragraph mid-line breaks that and makes a checkbox tick the wrong task. This guard lexes every
 * Markdown file in the repository (docs, READMEs, the Obsidian fixture vault) plus the mid-line
 * family rows and checks the token raws add up to the note.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { lexNote, stripFrontmatter } from "./obsidian";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const files = execFileSync("git", ["ls-files", "*.md"], {
  cwd: root,
  encoding: "utf8",
})
  .split("\n")
  .filter((f) => f && !f.includes("node_modules"));

const covers = (text: string) => {
  const body = stripFrontmatter(text).replace(/\r\n?/g, "\n");
  return (
    lexNote(text)
      .tokens.map((t) => t.raw)
      .join("") === body
  );
};

describe("reading-view tokens cover every note exactly", () => {
  it("finds the repository's Markdown files", () => {
    expect(files.length).toBeGreaterThan(20);
  });
  it("every Markdown file lexes to tokens that add up to the file", () => {
    const bad = files.filter(
      (f) => !covers(readFileSync(join(root, f), "utf8")),
    );
    expect(bad).toEqual([]);
  });
});
