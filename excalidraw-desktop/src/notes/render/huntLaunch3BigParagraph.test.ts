/**
 * Launch hunter 3 [launch] [notes], PERFORMANCE (next door to 288, b373e314): the reading view is
 * still quadratic for one long paragraph, a long blockquote, and many inline-math lines. A pasted
 * log or a CSV of 20,000 lines with no blank line freezes the window for tens of seconds.
 * Measured (load 6-9): one paragraph of lines with a wikilink, a tag and ==mark==: 2,000 lines
 * 0.47 s, 8,000 lines 7.4 s (ratio 15.7 for 4x the text). Cause: the inline extensions' `start()`
 * (obsidian.ts: `src.indexOf("[[")`, "![[", "#", "==", "$", "%%", "[^") scan the whole rest of
 * the paragraph for every text token, and marked makes one text token per stretch of plain text.
 * Obsidian opens such a note at once. `it.fails` turns red when it is fixed: drop `fails`.
 */
import { describe, expect, it } from "vitest";

import { renderNoteHtml } from "./obsidian";

const time = (md: string) => {
  const t = performance.now();
  renderNoteHtml(md, { resolve: () => null, highlight: false, math: true });
  return performance.now() - t;
};
const lines = (n: number, f: (i: number) => string) =>
  Array.from({ length: n }, (_, i) => f(i)).join("\n");

describe("launch hunter 3: render time of a note with no blank line grows linearly", () => {
  it.fails(
    "one paragraph of 1,000 vs 4,000 lines: under 8x for 4x the text",
    () => {
      const f = (i: number) =>
        `log line ${i} with [[Welcome]] and #tag and ==mark==`;
      time(lines(200, f));
      const a = time(lines(1000, f));
      const b = time(lines(4000, f));
      expect(b / Math.max(a, 1)).toBeLessThan(8);
    },
    60_000,
  );
});
