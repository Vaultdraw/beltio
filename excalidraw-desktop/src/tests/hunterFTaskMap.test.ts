import { describe, expect, it } from "vitest";

import { toggleTask } from "../notes/noteTasks";
import { renderNoteHtml } from "../notes/render/obsidian";
import { sanitizeNoteHtml } from "../notes/render/sanitize";

/**
 * Hunter F-12 (2026-10-30). Ticking a checkbox in the reading view finds its source line by
 * counting task-shaped lines (`noteTasks.ts taskLines`: "the Nth checkbox of the rendered page is
 * the Nth task line"), skipping only fenced code and front matter. A task-shaped line that the
 * renderer does NOT turn into a checkbox still counts: indented code (four spaces after a blank
 * line), an HTML comment block, a math block. Every checkbox after it then ticks the line BEFORE
 * its own, and the user's note is changed in the wrong place (a saved write).
 */
const boxes = (md: string) =>
  (
    sanitizeNoteHtml(
      renderNoteHtml(md, {
        resolve: () => null,
        highlight: true,
        math: true,
      } as never),
      { remoteImages: false },
    ).match(/type="checkbox"/g) ?? []
  ).length;

describe("hunter F-12: the Nth checkbox is the Nth task line", () => {
  const code =
    "How to write one:\n\n    - [ ] this is code\n\n- [ ] the real task\n";
  const comment = "<!--\n- [ ] commented out\n-->\n\n- [ ] the real task\n";

  it("(context) the renderer shows one checkbox for each", () => {
    expect(boxes(code)).toBe(1);
    expect(boxes(comment)).toBe(1);
  });
  it.fails(
    "ticking the only checkbox ticks the real task, not the code line",
    () => {
      expect(toggleTask(code, 0)).toBe(
        code.replace("- [ ] the real", "- [x] the real"),
      );
    },
  );
  it.fails(
    "ticking the only checkbox ticks the real task, not the commented line",
    () => {
      expect(toggleTask(comment, 0)).toBe(
        comment.replace("- [ ] the real", "- [x] the real"),
      );
    },
  );
});
