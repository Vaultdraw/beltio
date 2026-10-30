import { describe, expect, it } from "vitest";

import { taskLines } from "../notes/noteTasks";
import { renderNoteHtml } from "../notes/render/obsidian";
import { sanitizeNoteHtml } from "../notes/render/sanitize";

/**
 * Hunter F-12 (2026-10-30). Ticking a checkbox in the reading view first checks that the page has
 * as many checkboxes as the source has task lines (`NoteView.tsx tickTask`: `boxes.length ===
 * taskLines(source).length`), else it refuses with "Couldn't match that checkbox to the note. Edit
 * it instead." `taskLines` (`noteTasks.ts`) skips only fenced code and front matter, so a
 * task-shaped line the renderer shows no checkbox for (indented code, an HTML comment block) makes
 * the counts differ and EVERY checkbox in that note refuses to tick. (The guard stops a wrong-line
 * write; the bug is the refusal.)
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

describe("hunter F-12: a note with a task-shaped example can still tick its real tasks", () => {
  const code =
    "How to write one:\n\n    - [ ] this is code\n\n- [ ] the real task\n";
  const comment = "<!--\n- [ ] commented out\n-->\n\n- [ ] the real task\n";

  it("(context) the renderer shows one checkbox for each", () => {
    expect(boxes(code)).toBe(1);
    expect(boxes(comment)).toBe(1);
  });
  it("the source has as many task lines as the page has checkboxes (indented code)", () => {
    expect(taskLines(code).length).toBe(boxes(code));
  });
  it("the same with a task inside an HTML comment", () => {
    expect(taskLines(comment).length).toBe(boxes(comment));
  });
});
