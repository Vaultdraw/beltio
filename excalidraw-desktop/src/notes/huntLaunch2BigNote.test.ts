// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { lexNote } from "./render/obsidian";

// Launch hunter 2 (2026-10-31) [launch] [notes]: the reading view lexes a note in time that grows
// with the SQUARE of its size. Marked's own lexer reads 1 MB in about 70 ms; with the app's
// extensions it takes 8 to 12 s, and a 4 MB note froze the window for minutes. Cause (suspected):
// the block extensions' `start()` (blockStart: a regex over the whole rest of the note for `$$`,
// `%%`, footnote definitions) runs again for every block, and finds nothing, so each call scans to
// the end. Obsidian opens a 1 MB note at once. The check is a growth ratio, not a clock: lexing
// 4 times the text must cost under 8 times the time (linear is 4, quadratic is 16).

const note = (kb: number) => {
  const out: string[] = ["# Big log\n"];
  let len = 0;
  for (let n = 0; len < kb * 1024; n++) {
    const s = `## Entry ${n}\n\n- item ${n}\n- item two\n\nParagraph ${n} lorem ipsum dolor sit amet, consectetur.\n`;
    out.push(s);
    len += s.length;
  }
  return out.join("\n");
};
const best = (text: string) => {
  let min = Infinity;
  for (let i = 0; i < 2; i++) {
    const t0 = performance.now();
    lexNote(text, true);
    min = Math.min(min, performance.now() - t0);
  }
  return min;
};

describe("a big note opens in time that grows about linearly (toimprove 288)", () => {
  it.fails(
    "lexing 4 times the text costs under 8 times the time",
    () => {
      const small = best(note(150));
      const big = best(note(600));
      expect(big / small).toBeLessThan(8);
    },
    120_000,
  );
});
