/**
 * Family: every Markdown construct imports readable (toimprove 68/69). One sweep over the golden
 * notes (the real parser's output for tables, nested lists, task lists, code, callouts, quotes,
 * footnotes, math, rules, headings, embeds): nothing is cut, no stray rules, nothing overlaps.
 * A new construct is one more `goldens/<name>.md` + `.doc.json`.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { layoutNote } from "../../src/layout/index";
import { buildWidthTable } from "../../src/layout/widthTable";

import { defaultOptions, fakeMeasure } from "./fixtures";

import type { NoteBlock, NoteDoc } from "@vaultdraw/api";
import type { PageItem, PageItemText } from "../../src/layout/types";

const dir = path.join(__dirname, "goldens");
const names = readdirSync(dir)
  .filter((f) => f.endsWith(".doc.json"))
  .map((f) => f.replace(/\.doc\.json$/, ""))
  .sort();

/** The words a reader should find, from every block that has text. */
const wordsOf = (blocks: readonly NoteBlock[]): string[] =>
  blocks.flatMap((b): string[] => {
    const any = b as any;
    const own = [
      any.text,
      any.title,
      any.latex,
      ...(any.header ?? []),
      ...(any.rows ?? []).flat(),
    ]
      .filter((s): s is string => typeof s === "string")
      .flatMap((s) => s.split(/\s+/));
    return [...own, ...(any.blocks ? wordsOf(any.blocks) : [])];
  });

const squash = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();

const count = (blocks: readonly NoteBlock[], kind: string): number =>
  blocks.reduce(
    (n, b) =>
      n +
      (b.kind === kind ? 1 : 0) +
      ((b as any).blocks ? count((b as any).blocks, kind) : 0),
    0,
  );

const overlap = (a: PageItemText, b: PageItemText) =>
  a.page === b.page &&
  a.x < b.x + b.width - 0.5 &&
  b.x < a.x + a.width - 0.5 &&
  a.y < b.y + b.height - 0.5 &&
  b.y < a.y + a.height - 0.5;

describe.each(names)("construct sweep: %s", (name) => {
  const doc = JSON.parse(
    readFileSync(path.join(dir, `${name}.doc.json`), "utf8"),
  ) as NoteDoc;
  const opts = defaultOptions();
  const result = layoutNote(doc, buildWidthTable(fakeMeasure, doc, opts), opts);
  const items: PageItem[] = result.parts.flatMap((p) => p.items);
  const texts = items.filter((i): i is PageItemText => i.type === "text");
  const drawn = squash(texts.map((t) => t.text).join(" "));
  const source = readFileSync(path.join(dir, `${name}.md`), "utf8");

  test("nothing is cut: every word of the note is drawn", () => {
    const missing = wordsOf(doc.blocks).filter((w) => {
      const s = squash(w);
      return s !== "" && !drawn.includes(s);
    });
    expect(missing).toEqual([]);
  });

  test("no ellipsis or box-drawing characters that the note did not have", () => {
    for (const ch of ["…", "─", "│", "┼"]) {
      if (!source.includes(ch)) {
        expect(
          texts.some((t) => t.text.includes(ch)),
          ch,
        ).toBe(false);
      }
    }
  });

  test("no stray rules: the only full-width lines are the note's own horizontal rules", () => {
    const borders = items.filter(
      (i) =>
        i.type === "rect" &&
        (i as any).fill === "none" &&
        (i as any).stroke === "thin",
    );
    const lines = items.filter((i) => i.type === "line");
    const outside = lines.filter(
      (l) =>
        !borders.some(
          (b) =>
            b.page === l.page &&
            l.x >= b.x - 0.01 &&
            l.x + l.width <= b.x + b.width + 0.01 &&
            l.y >= b.y - 0.01 &&
            l.y + l.height <= b.y + b.height + 0.01,
        ),
    );
    // Footnotes sit under one separator rule of their own.
    const own =
      count(doc.blocks, "thematicBreak") +
      (count(doc.blocks, "footnoteDef") > 0 ? 1 : 0);
    expect(outside.length).toBe(own);
  });

  test("no two texts overlap", () => {
    for (let i = 0; i < texts.length; i++) {
      for (let j = i + 1; j < texts.length; j++) {
        if (overlap(texts[i], texts[j])) {
          throw new Error(
            `overlap: ${JSON.stringify(texts[i].text)} and ${JSON.stringify(
              texts[j].text,
            )}`,
          );
        }
      }
    }
  });
});
