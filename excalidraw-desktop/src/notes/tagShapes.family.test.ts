// @vitest-environment jsdom
/**
 * Family "twin parsers: tags" (J-8 pinned a list of shapes where the reading-view chips and the
 * tag pane's grammar agree). This sweep adds the shapes that sit inside OTHER syntax: where a `#`
 * is not a tag in Obsidian (code, urls, link targets, headings, html, math, comments) and where
 * it is (list items, quotes, callouts, tables, emphasis). For each source the chips of the reading
 * view must be exactly `expected`; `broken` rows are `it.fails`.
 */
import { describe, expect, it } from "vitest";

import { findTags } from "../tags/grammar";

import { renderNoteHtml } from "./render/obsidian";
import { sanitizeNoteHtml } from "./render/sanitize";

const chips = (md: string): string[] => {
  const div = document.createElement("div");
  div.innerHTML = sanitizeNoteHtml(
    renderNoteHtml(md, { resolve: () => null, highlight: false, math: true }),
    { remoteImages: false },
  );
  return [...div.querySelectorAll<HTMLElement>(".note-tag")].map(
    (e) => e.dataset.tag ?? "",
  );
};

type Row = { name: string; md: string; expected: string[]; broken?: boolean };
const rows: Row[] = [
  { name: "plain", md: "a #one b", expected: ["one"] },
  { name: "in a list item", md: "- #one\n- x #two", expected: ["one", "two"] },
  { name: "in a task", md: "- [ ] do #one", expected: ["one"] },
  { name: "in a quote", md: "> a #one", expected: ["one"] },
  {
    name: "in a callout title",
    md: "> [!note] About #one\n> body",
    expected: ["one"],
  },
  { name: "in a table cell", md: "| h |\n|---|\n| #one |", expected: ["one"] },
  {
    name: "in bold and italic",
    md: "**#one** and *#two*",
    expected: ["one", "two"],
  },
  { name: "in a footnote", md: "a[^1]\n\n[^1]: see #one", expected: ["one"] },
  { name: "nested tag with slash", md: "#a/b/c", expected: ["a/b/c"] },
  { name: "in inline code", md: "use `#one` here", expected: [] },
  { name: "in a fence", md: "```\n#one\n```", expected: [] },
  { name: "in indented code", md: "para\n\n    #one", expected: [] },
  {
    name: "in a url fragment",
    md: "see https://x.y/page#one now",
    expected: [],
  },
  {
    name: "in an angle url",
    md: "see <https://x.y/page#one> now",
    expected: [],
  },
  { name: "in a link target", md: "[text](page.md#one)", expected: [] },
  { name: "in a wikilink heading", md: "[[Note#one]]", expected: [] },
  { name: "in a wikilink alias", md: "[[Note|about #one]]", expected: [] },
  { name: "in an embed size", md: "![[pic.png#one]]", expected: [] },
  { name: "in an html attribute", md: '<a href="#one">x</a>', expected: [] },
  { name: "in an html comment", md: "<!-- #one -->", expected: [] },
  { name: "in a %% comment", md: "%% #one %%", expected: [] },
  { name: "in inline math", md: "$a #one b$", expected: [] },
  { name: "in a math block", md: "$$\n#one\n$$", expected: [] },
  {
    name: "in a heading line start (a heading, not a tag)",
    md: "# one",
    expected: [],
  },
  { name: "in a heading text", md: "# Title #one", expected: ["one"] },
  { name: "in an image alt", md: "![alt #one](pic.png)", expected: [] },
  { name: "in a block id", md: "text ^one", expected: [] },
  { name: "escaped hash", md: "a \\#one b", expected: [] },
  {
    name: "in front matter body is not rendered",
    md: "---\ntags: [x]\n---\nbody #one",
    expected: ["one"],
  },
  { name: "a hash then space", md: "a # one b", expected: [] },
  { name: "a number tag", md: "issue #123 and #1a", expected: ["1a"] },
  { name: "twice the same tag", md: "#one and #one", expected: ["one", "one"] },
];

describe("tag chips in the reading view, by the syntax around the #", () => {
  for (const r of rows) {
    (r.broken ? it.fails : it)(r.name, () => {
      expect(chips(r.md)).toEqual(r.expected);
    });
  }
});

describe("the same sources in the tag pane's grammar (findTags) for the plain-text rows", () => {
  for (const r of rows.filter((x) =>
    /^(plain|nested tag|a hash then space|a number tag|twice)/.test(x.name),
  )) {
    it(r.name, () => {
      expect(findTags(r.md).map((m) => m.display)).toEqual(r.expected);
    });
  }
});
