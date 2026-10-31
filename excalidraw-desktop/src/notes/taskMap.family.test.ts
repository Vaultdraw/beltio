/**
 * Family (validator, 2026-10-30, hunter F-12): "tick the Nth checkbox of the reading view → the Nth
 * rendered task changes in the file, and nothing else" over every Markdown shape that can hold a
 * task-shaped line. Invariant per note: the renderer's checkbox count equals `taskLines`, and
 * ticking checkbox i makes exactly checkbox i checked after a re-render (no other line changes).
 * Rows that fail today are `it.fails`; drop `fails` when fixed. Adding a shape costs one row.
 */
import { describe, expect, it } from "vitest";

import { taskLines, toggleTask } from "./noteTasks";
import { renderNoteHtml } from "./render/obsidian";
import { sanitizeNoteHtml } from "./render/sanitize";

const checked = (md: string): boolean[] => {
  const html = sanitizeNoteHtml(
    renderNoteHtml(md, {
      resolve: () => null,
      highlight: false,
      math: true,
    } as never),
    { remoteImages: false },
  );
  const div = document.createElement("div");
  div.innerHTML = html;
  return [
    ...div.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
  ].map((b) => b.hasAttribute("checked"));
};

type Row = { name: string; md: string; broken?: boolean };

const REAL = "- [ ] real one\n- [ ] real two\n";
const rows: Row[] = [
  { name: "plain list", md: REAL },
  { name: "numbered and star markers", md: "1. [ ] a\n* [ ] b\n+ [x] c\n" },
  { name: "nested list", md: "- [ ] a\n  - [ ] b\n    - [ ] c\n" },
  { name: "in a quote", md: `> - [ ] quoted\n\n${REAL}` },
  { name: "in a callout", md: `> [!todo]\n> - [ ] in callout\n\n${REAL}` },
  { name: "after front matter", md: `---\ntags: [a]\n---\n${REAL}` },
  { name: "after a backtick fence", md: `\`\`\`\n- [ ] code\n\`\`\`\n${REAL}` },
  { name: "after a tilde fence", md: `~~~md\n- [ ] code\n~~~\n${REAL}` },
  {
    name: "after indented code",
    md: `Example:\n\n    - [ ] code\n\n${REAL}`,
  },
  {
    name: "after an HTML comment",
    md: `<!--\n- [ ] hidden\n-->\n\n${REAL}`,
  },
  {
    // passes today only because the reading view still shows %% comments (hunter F-11); when
    // they are hidden, taskLines must skip them too
    name: "after an Obsidian %% comment %% block",
    md: `%%\n- [ ] hidden\n%%\n\n${REAL}`,
  },
  {
    name: "after a math block",
    md: `$$\n- [ ] x\n$$\n\n${REAL}`,
  },
  { name: "with CRLF line ends", md: REAL.replace(/\n/g, "\r\n") },
  {
    name: "list item continued by a four-space paragraph",
    md: "- [ ] a\n\n    still a\n- [ ] b\n",
  },
  // Added by the family hunter [notes] (2026-10-31): more shapes that hold a task-shaped line.
  {
    name: "capital X and other status marks",
    md: "- [X] a\n- [-] b\n- [/] c\n- [ ] d\n",
  },
  { name: "ordered with a paren", md: "1) [ ] a\n2) [x] b\n" },
  { name: "empty task text", md: "- [ ]\n- [ ] after\n" },
  {
    name: "task in a table cell is not a task",
    md: `| a |\n|---|\n| - [ ] cell |\n\n${REAL}`,
  },
  {
    name: "task in a footnote definition",
    md: `x[^1]\n\n[^1]: - [ ] in note\n\n${REAL}`,
  },
  { name: "after an html block", md: `<div>\n- [ ] html\n</div>\n\n${REAL}` },
  { name: "after a setext heading", md: `Title\n=====\n\n${REAL}` },
  { name: "tab indented nesting", md: "- [ ] a\n\t- [ ] b\n\t\t- [ ] c\n" },
  { name: "lone CR line ends", md: REAL.replace(/\n/g, "\r") },
  {
    name: "BOM then front matter with dots",
    md: `\uFEFF---\na: 1\n...\n${REAL}`,
  },
  {
    name: "loose list with blank lines",
    md: "- [ ] a\n\n- [ ] b\n\n- [x] c\n",
  },
  {
    name: "task text with wikilink, code and math",
    md: "- [ ] see [[Note]] `- [ ] x` $a$\n- [ ] two\n",
  },
  {
    name: "fence inside a list item",
    md: "- [ ] a\n  ```\n  - [ ] code\n  ```\n- [ ] b\n",
  },
  {
    name: "quote nested in a list item",
    md: "- [ ] a\n  > - [ ] quoted\n- [ ] b\n",
  },
  {
    name: "callout nested in a list item",
    md: "- [ ] a\n  > [!note]\n  > - [ ] in callout\n- [ ] b\n",
  },
  {
    name: "task straight after a paragraph line",
    md: "text\n- [ ] a\n- [ ] b\n",
  },
  { name: "task right under a heading, no blank", md: "# H\n- [ ] a\n" },
  {
    name: "inline %% comment spanning lines",
    md: `a %%\n- [ ] hidden\n%% b\n\n${REAL}`,
  },
  { name: "after a $$ block on one line", md: `$$ x $$\n\n${REAL}` },
  { name: "unclosed fence swallows the rest", md: "```\n- [ ] code\n" },
  { name: "unclosed math block", md: "$$\n- [ ] x\n\n- [ ] y\n" },
  { name: "unclosed %% comment", md: "%%\n- [ ] x\n\n- [ ] y\n" },
  {
    name: "unicode line separator inside text",
    md: "- [ ] a\u2028b\n- [ ] c\n",
  },
  {
    name: "a form feed and a vertical tab",
    md: "- [ ] a\fb\n- [ ] c\u000bd\n",
  },
  {
    name: "emoji and combining marks before the task",
    md: "# \u{1F600}e\u0301\n\n- [ ] a\n",
  },
  {
    name: "60 tasks",
    md: Array.from({ length: 60 }, (_, i) => `- [ ] t${i}`).join("\n"),
  },
  { name: "star bullets with hard breaks", md: "* [ ] a  \n  more\n* [ ] b\n" },
  {
    name: "html comment inline, same line",
    md: "<!-- c --> - [ ] a\n\n- [ ] b\n",
  },
  {
    name: "reference definition between tasks",
    md: "- [ ] a\n\n[ref]: https://x.y\n\n- [ ] b\n",
  },
];

describe("family: the Nth checkbox ticks the Nth rendered task", () => {
  for (const row of rows) {
    (row.broken ? it.fails : it)(row.name, () => {
      const before = checked(row.md);
      expect(taskLines(row.md).length, "checkboxes vs task lines").toBe(
        before.length,
      );
      before.forEach((was, i) => {
        const next = toggleTask(row.md, i);
        expect(next, `checkbox ${i}`).not.toBeNull();
        const after = checked(next!);
        expect(after, `checkbox ${i}`).toEqual(
          before.map((v, j) => (j === i ? !was : v)),
        );
      });
    });
  }
});
