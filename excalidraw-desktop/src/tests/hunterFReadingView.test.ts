import { describe, expect, it } from "vitest";

import { renderNoteHtml } from "../notes/render/obsidian";
import { sanitizeNoteHtml } from "../notes/render/sanitize";

/**
 * Hunter F-11 (2026-10-30), parity with Obsidian's reading view for plain Markdown that the
 * Markdown import (Rust, `markdown/`) already handles. The reading view (`notes/render/obsidian.ts`:
 * `new Marked({ gfm: true, breaks: false })`, no line-break CSS) shows:
 *  - a single newline inside a paragraph as a space (Obsidian's default, "Strict line breaks" off,
 *    shows a line break);
 *  - `%%comment%%` as text (Obsidian hides it);
 *  - a trailing `^block-id` as text (Obsidian hides the marker);
 *  - `[^1]` and its definition as raw text (Obsidian renders a footnote).
 */
const html = (md: string) =>
  sanitizeNoteHtml(
    renderNoteHtml(md, {
      resolve: () => null,
      highlight: true,
      math: true,
    } as never),
    { remoteImages: false },
  );

describe("hunter F-11: the reading view follows Obsidian for plain Markdown", () => {
  it.fails("a single newline is a line break", () => {
    expect(html("line one\nline two")).toMatch(/line one<br\s*\/?>\s*line two/);
  });
  it.fails("%%comments%% are hidden", () => {
    expect(html("keep %%drop%% this")).not.toContain("drop");
  });
  it.fails("a trailing ^block-id is not shown", () => {
    expect(html("para ^blockid\n\nnext")).not.toContain("^blockid");
  });
  it.fails("a footnote reference becomes a link, not the raw [^1]", () => {
    expect(html("Fact[^1]\n\n[^1]: the source")).not.toContain("[^1]");
  });
});
