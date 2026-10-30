/**
 * Hunter L (2026-10-30 night) [notes], the reading view's renderer next to the evening's fixes.
 *
 * L-9 (next door to 218, 4417edaa): a drawing embed with the Excalidraw plugin's size,
 * `![[Sketch|500]]` (or `|500x300`), becomes a link whose text is "500": the size is taken as the
 * link's label. Obsidian with the Excalidraw plugin reads `|500` as the width (as for pictures,
 * imageSize.ts); the label stays the drawing's name.
 *
 * L-10 (next door to 222, footnotes): a footnote referenced only inside another footnote's text
 * gets a number but is never listed, so its number leads nowhere. Obsidian lists it.
 */
import { describe, expect, it } from "vitest";

import { renderNoteHtml } from "./obsidian";
import { sanitizeNoteHtml } from "./sanitize";

const html = (md: string) =>
  sanitizeNoteHtml(
    renderNoteHtml(md, {
      resolve: (t) => (t === "Sketch" ? "Drawings/Sketch.excalidraw" : null),
      highlight: false,
      math: true,
    }),
    { remoteImages: false },
  );

const linkText = (out: string) =>
  /<a class="wikilink"[^>]*>([^<]*)<\/a>/.exec(out)?.[1];

describe("hunter L-9: a drawing embed with a size", () => {
  it("sanity: an alias is the link's text", () => {
    expect(linkText(html("![[Sketch|my sketch]]"))).toBe("my sketch");
  });

  it.each(["![[Sketch|500]]", "![[Sketch|500x300]]"])(
    "%s reads as the drawing's name, not the size",
    (md) => {
      expect(linkText(html(md))).toBe("Sketch");
    },
  );
});

describe("hunter L-10: a footnote referenced inside another footnote", () => {
  it("sanity: a plain footnote is listed", () => {
    expect(html("A[^a]\n\n[^a]: first")).toContain('id="fn-a"');
  });

  it("is listed too, so its number leads somewhere", () => {
    const out = html("A[^a]\n\n[^a]: see [^b]\n[^b]: inner");
    expect(out).toContain('href="#fn-b"');
    expect(out).toContain('id="fn-b"');
  });
});
