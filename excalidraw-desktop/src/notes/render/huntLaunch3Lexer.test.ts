import { describe, expect, it } from "vitest";

import { renderNoteHtml } from "./obsidian";
import { sanitizeNoteHtml } from "./sanitize";

const html = (md: string) =>
  sanitizeNoteHtml(
    renderNoteHtml(md, { resolve: () => null, highlight: false, math: true }),
    { remoteImages: false },
  );

describe("launch hunter 3: the linear block starts (288) keep the block syntax", () => {
  it("a %% comment with a blank line inside hides all of it", () => {
    const out = html("before\n\n%%\nhidden one\n\nhidden two\n%%\n\nafter\n");
    expect(out).not.toContain("hidden");
    expect(out).toContain("after");
  });
  it("a %% comment right after a paragraph line (no blank line) interrupts it", () => {
    const out = html("text line\n%% secret %%\nnext\n");
    expect(out).not.toContain("secret");
  });
  it("block math right after a paragraph line, with a blank line inside, renders as math", () => {
    const out = html("lead in\n$$\na = 1\n\nb = 2\n$$\n\ntail\n");
    expect(out).toContain("tail");
    expect(out).not.toContain("$$");
  });
  it("a footnote definition directly under a paragraph line is a definition", () => {
    const out = html("Claim[^1]\n[^1]: The note.\n");
    expect(out).toContain("The note.");
    expect(out).not.toContain("[^1]:");
  });
  it("a footnote definition with an indented second paragraph keeps both", () => {
    const out = html("Claim[^1]\n\n[^1]: First.\n\n    Second para.\n");
    expect(out).toContain("First.");
    expect(out).toContain("Second para.");
  });
  it("two comments in one paragraph both hide", () => {
    const out = html("a %%x1%% b %%x2%% c\n");
    expect(out).not.toContain("x1");
    expect(out).not.toContain("x2");
  });
});
