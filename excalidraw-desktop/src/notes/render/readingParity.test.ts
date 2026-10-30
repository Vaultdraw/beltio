import { describe, expect, it } from "vitest";

import { renderNoteHtml } from "./obsidian";
import { sanitizeNoteHtml } from "./sanitize";

const html = (md: string, strictLineBreaks = false) =>
  sanitizeNoteHtml(
    renderNoteHtml(md, {
      resolve: () => null,
      highlight: false,
      math: true,
      strictLineBreaks,
    }),
    { remoteImages: false },
  );

describe("reading view parity with Obsidian", () => {
  it("strict line breaks joins the lines", () => {
    expect(html("a\nb", true)).not.toContain("<br");
    expect(html("a\n\nb")).toContain("<p>b</p>");
  });
  it("hides a multi-line %% comment and an inline one, keeping the text around", () => {
    const out = html("before\n\n%%\nsecret\nmore\n%%\n\nafter %%x%% end");
    expect(out).not.toMatch(/secret|more|>x</);
    expect(out).toContain("before");
    expect(out).toContain("after");
    expect(out).toContain("end");
  });
  it("lists footnotes in order of first reference, numbers repeats alike", () => {
    const out = html("A[^b] B[^a] C[^b]\n\n[^a]: second\n[^b]: first");
    expect(out.match(/class="footnote-ref"/g)).toHaveLength(3);
    expect(out.indexOf("first")).toBeLessThan(out.indexOf("second"));
    expect(out).toContain('id="fn-a"');
  });
  it("shows no footnote list for a reference without a definition", () => {
    expect(html("A[^zz]")).not.toContain("footnotes");
  });
  it("one note's footnotes never leak into the next render", () => {
    html("A[^1]\n\n[^1]: one");
    expect(html("plain")).not.toContain("footnotes");
  });
  it("a block id leaves an invisible marker", () => {
    const out = html("para ^abc-1\n\nnext");
    expect(out).toContain('data-block-id="abc-1"');
    expect(out).not.toContain("^abc-1");
  });
});
