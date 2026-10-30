import { describe, expect, it } from "vitest";

import { renderNoteHtml } from "../notes/render/obsidian";
import { sanitizeNoteHtml } from "../notes/render/sanitize";

/**
 * Hunter F-16 (2026-10-30). Obsidian reads `![alt|100](pics/a.png)` as alt "alt" and width 100
 * (and `|100x50` as width and height). The Markdown import already does (`alt_size_cases.json`).
 * The reading view keeps "alt|100" as the alt text and sets no size; its `![[img.png|200]]` form
 * does take the size (`hydrate.ts`).
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

describe("hunter F-16: the reading view reads the |size of a Markdown image", () => {
  it("(context) the [[embed]] form carries its size", () => {
    expect(html("![[a.png|200]]")).toContain('data-alias="200"');
  });
  it.fails("![alt|100](a.png) has width 100 and alt 'alt'", () => {
    const out = html("![alt|100](a.png)");
    expect(out).toMatch(/width="100"/);
    expect(out).toContain('alt="alt"');
  });
  it.fails("![alt|100x50](a.png) has width and height", () => {
    const out = html("![alt|100x50](a.png)");
    expect(out).toMatch(/width="100"/);
    expect(out).toMatch(/height="50"/);
  });
});
