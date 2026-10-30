import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Guard (validator, 2026-10-30, hunter G-1, toimprove 195): the note reading view wraps long
 * unbroken words (hashes, paths, long `[[names]]`, inline code) like Obsidian; it never scrolls
 * sideways. Only `.note-property dd` had `overflow-wrap`, so any long word in a paragraph,
 * heading, list, quote or table cell widened the whole view. The browser check is
 * `e2e/families/huntG-note-long-lines.spec.ts`; this one runs in the fast tier.
 */
const css = readFileSync(join(__dirname, "../notes/notes.css"), "utf8");
const rule = (selector: string) => {
  const m = new RegExp(
    `(?:^|\\n|,)\\s*${selector.replace(/[.]/g, "\\.")}\\s*\\{([^}]*)\\}`,
  ).exec(css);
  return m?.[1] ?? "";
};

describe("guard: the note reading view wraps long words", () => {
  // Passes since 93258d79 (toimprove 195); the row stayed it.fails unseen because the fast tier
  // never ran this file (it reads CSS, imports nothing): toimprove 266.
  it("`.note-body` breaks a word that does not fit (overflow-wrap)", () => {
    expect(rule(".note-body")).toMatch(
      /overflow-wrap:\s*(anywhere|break-word)/,
    );
  });
  it("(context) a property value already wraps", () => {
    expect(css).toMatch(
      /\.note-property dd\s*\{[^}]*overflow-wrap:\s*anywhere/,
    );
  });
});
