// @vitest-environment jsdom
/**
 * Family "every id the reading view writes is unique in one note" (J-11 covered ids that collide
 * across embeds; this covers the note's own ids): headings, footnote references and footnote
 * entries. A duplicate `id` makes a backlink or a `#heading` link always land on the first one.
 * Repeated headings are left alone on purpose (Obsidian's `[[Note#Heading]]` also takes the first). Obsidian numbers repeated footnote references (`fnref-a-2`); we do not (toimprove 309). One row per shape; `broken` rows are `it.fails`.
 */
import { describe, expect, it } from "vitest";

import { renderNoteHtml } from "./obsidian";
import { sanitizeNoteHtml } from "./sanitize";

const ids = (md: string): string[] => {
  const div = document.createElement("div");
  div.innerHTML = sanitizeNoteHtml(
    renderNoteHtml(md, { resolve: () => null, highlight: false, math: true }),
    { remoteImages: false },
  );
  return [...div.querySelectorAll("[id]")].map((e) => e.id);
};

const rows: { name: string; md: string; broken?: boolean }[] = [
  { name: "distinct headings", md: "# A\n\n## B\n\n### C\n" },
  { name: "one footnote used once", md: "x[^a]\n\n[^a]: note\n" },
  {
    name: "the same footnote used twice",
    md: "x[^a] and y[^a]\n\n[^a]: note\n",
    broken: true,
  },
  {
    name: "a heading whose slug is a footnote's id (fn-1)",
    md: "# fn-1\n\nx[^1]\n\n[^1]: note\n",
    broken: true,
  },
  {
    name: "a heading whose slug is a footnote reference's id (fnref-1)",
    md: "# fnref-1\n\nx[^1]\n\n[^1]: note\n",
    broken: true,
  },
  {
    name: "two footnotes with distinct names, one used twice",
    md: "x[^a][^b][^a]\n\n[^a]: A\n[^b]: B\n",
    broken: true,
  },
];

describe("every id one note writes is unique", () => {
  for (const row of rows) {
    (row.broken ? it.fails : it)(row.name, () => {
      const all = ids(row.md);
      expect(all.length).toBeGreaterThan(0);
      expect(new Set(all).size, all.join(" ")).toBe(all.length);
    });
  }
});
