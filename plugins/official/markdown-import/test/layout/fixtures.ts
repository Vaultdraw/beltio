/**
 * Test doubles for the layout: a canvas-like measure with kerning (so the
 * width table has pairs to get right), a note generator with the 12-block
 * cycle of the prototype (RESEARCH.md), and the default options.
 */
import type { NoteBlock, NoteDoc, TextFont } from "@vaultdraw/api";
import type { LayoutOptions } from "../../src/layout/types";

/** Advance of one code point: deterministic, varied, scaled by size. */
export const fakeAdvance = (cp: number, size: number): number => {
  if (cp === 32) {
    return size * 0.27;
  }
  // Letters between 0.42 and 0.68 em, other characters 0.3 to 0.9 em.
  const h = (cp * 2654435761) % 1000;
  return size * (0.42 + (h / 1000) * 0.26) + (cp > 0x2000 ? size * 0.3 : 0);
};

/** Kerning of a pair: a few pairs kern, like a real font ("AV", "To", "ry"). */
export const fakeKern = (a: number, b: number, size: number): number => {
  if ((a * 31 + b) % 17 === 0) {
    return -size * 0.05;
  }
  if ((a * 7 + b) % 23 === 0) {
    return size * 0.02;
  }
  return 0;
};

/** `measureText` of a string: advances plus pair kerning, like canvas. */
export const fakeLineWidth = (text: string, size: number): number => {
  let w = 0;
  let prev = -1;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    w += fakeAdvance(cp === 9 ? 32 : cp, size);
    if (prev >= 0 && cp < 0x10000 && prev < 0x10000) {
      w += fakeKern(prev, cp === 9 ? 32 : cp, size);
    }
    prev = cp >= 0x10000 ? -1 : cp;
  }
  return w;
};

/** The shape of `ctx.text.measure`, with kerning. */
export const fakeMeasure = (font: TextFont, strings: readonly string[]) =>
  Float64Array.from(strings, (s) => fakeLineWidth(s, font.size));

export const A4 = { width: 794, height: 1123, margin: 48 };

export const defaultOptions = (
  over: Partial<LayoutOptions> = {},
): LayoutOptions => ({
  fonts: { body: "Nunito", heading: "Nunito", code: "Cascadia" },
  fontSize: 16,
  page: A4,
  ...over,
});

// --- generated notes --------------------------------------------------------

/** A small deterministic generator (mulberry32). */
const rng = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const WORDS =
  "the vault keeps every drawing in a folder you own offline first fast on the worst laptop keyboard everywhere config in plain files extensions when optional".split(
    " ",
  );

const words = (next: () => number, n: number): string => {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    if (next() < 0.5) {
      out.push(WORDS[Math.floor(next() * WORDS.length)]);
    } else {
      // Random letter strings: the worst case for a word cache.
      const len = 3 + Math.floor(next() * 9);
      let w = "";
      for (let j = 0; j < len; j++) {
        w += String.fromCharCode(97 + Math.floor(next() * 26));
      }
      out.push(w);
    }
  }
  return out.join(" ");
};

const countWords = (blocks: readonly NoteBlock[]): number => {
  let n = 0;
  for (const b of blocks) {
    if ("text" in b && typeof b.text === "string") {
      n += b.text.split(/\s+/).filter(Boolean).length;
    }
    if ("blocks" in b) {
      n += countWords(b.blocks);
    }
    if (b.kind === "table") {
      n += b.cellCount;
    }
  }
  return n;
};

/**
 * A note of about `targetWords` words built from a repeating 12-block
 * cycle: headings, paragraphs (with [[links]] and #tags), nested task and
 * ordered lists, fenced code, a 3-column table, a callout and display math.
 */
export const generateNote = (targetWords: number, seed = 1): NoteDoc => {
  const next = rng(seed);
  const blocks: NoteBlock[] = [];
  const range = [0, 0] as const;
  let count = 0;
  let section = 0;
  while (count < targetWords) {
    section++;
    const cycle: NoteBlock[] = [
      {
        kind: "heading",
        level: section % 5 === 1 ? 1 : 2,
        text: `Section ${section} ${words(next, 2)}`,
        range,
      },
      {
        kind: "paragraph",
        text: `${words(next, 60)} [[Vault note]] ${words(next, 20)} #tag/x`,
        range,
      },
      { kind: "heading", level: 3, text: words(next, 3), range },
      { kind: "paragraph", text: words(next, 90), range },
      {
        kind: "listItem",
        ordered: false,
        marker: "-",
        depth: 0,
        task: "open",
        text: words(next, 8),
        range,
      },
      {
        kind: "listItem",
        ordered: false,
        marker: "-",
        depth: 1,
        task: "done",
        text: words(next, 12),
        range,
      },
      {
        kind: "listItem",
        ordered: true,
        marker: "1.",
        depth: 0,
        task: "none",
        text: words(next, 7),
        range,
      },
      {
        kind: "listItem",
        ordered: true,
        marker: "2.",
        depth: 0,
        task: "none",
        text: words(next, 9),
        range,
      },
      {
        kind: "code",
        code: true,
        lang: "sh",
        text: `cargo build # ${words(
          next,
          4,
        )}\ncargo test --workspace\n\t${words(next, 6)}`,
        range,
      },
      {
        kind: "table",
        align: ["left", "right", "none"],
        header: ["Option", "Default", "Note"],
        rows: [
          ["mode", "fast", words(next, 3)],
          ["pages", "a4", words(next, 2)],
        ],
        cols: 3,
        cellCount: 9,
        range,
      },
      {
        kind: "callout",
        calloutType: "note",
        title: "Remember",
        foldState: "none",
        blocks: [{ kind: "paragraph", text: words(next, 30), range }],
        range,
      },
      { kind: "math", latex: "\\sum_{i=0}^{n} x_i^2", range },
    ];
    blocks.push(...cycle);
    count = countWords(blocks);
  }
  return {
    schemaVersion: 1,
    blocks,
    links: [],
    tags: ["tag/x"],
    stats: {
      words: count,
      blocks: blocks.length,
      droppedEmphasis: 0,
      droppedHtml: 0,
    },
  };
};
