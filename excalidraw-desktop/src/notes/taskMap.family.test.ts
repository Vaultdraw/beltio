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
  { name: "in a quote", md: "> - [ ] quoted\n\n" + REAL },
  { name: "in a callout", md: "> [!todo]\n> - [ ] in callout\n\n" + REAL },
  { name: "after front matter", md: "---\ntags: [a]\n---\n" + REAL },
  { name: "after a backtick fence", md: "```\n- [ ] code\n```\n" + REAL },
  { name: "after a tilde fence", md: "~~~md\n- [ ] code\n~~~\n" + REAL },
  {
    name: "after indented code",
    md: "Example:\n\n    - [ ] code\n\n" + REAL,
    broken: true,
  },
  {
    name: "after an HTML comment",
    md: "<!--\n- [ ] hidden\n-->\n\n" + REAL,
    broken: true,
  },
  {
    // passes today only because the reading view still shows %% comments (hunter F-11); when
    // they are hidden, taskLines must skip them too
    name: "after an Obsidian %% comment %% block",
    md: "%%\n- [ ] hidden\n%%\n\n" + REAL,
  },
  {
    name: "after a math block",
    md: "$$\n- [ ] x\n$$\n\n" + REAL,
    broken: true,
  },
  { name: "with CRLF line ends", md: REAL.replace(/\n/g, "\r\n") },
  {
    name: "list item continued by a four-space paragraph",
    md: "- [ ] a\n\n    still a\n- [ ] b\n",
  },
];

describe("family: the Nth checkbox ticks the Nth rendered task", () => {
  for (const row of rows) {
    const test = row.broken ? it.fails : it;
    test(row.name, () => {
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
