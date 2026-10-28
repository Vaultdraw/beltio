/**
 * Lays a table out as ordinary Excalidraw elements: one outline, a shaded header row, grid lines and
 * one text per cell, all in one group. Pure: the host's text measure is passed in.
 */
import type { FontFamilyName, SceneOp } from "@vaultdraw/api";

import type { ParsedTable } from "./parse";

export interface Style {
  fontFamily: FontFamilyName;
  fontSize: number;
  strokeColor: string;
  /** Widest a column may be, in pixels (text wraps beyond it). */
  maxColWidth: number;
}

export interface Measure {
  /** Widths of strings in the style's font. */
  widths(strings: readonly string[]): ArrayLike<number>;
  lineHeight: number;
}

/** Room around a cell's text, in pixels. */
export const PAD = 8;
/** A batch holds at most this many operations (the app's default limit is 500). */
export const MAX_OPS = 480;
export const HEADER_FILL = "#e9ecef";

/** Greedy word wrap to `width`; a word wider than the line is cut. Blank text gives []. */
export function wrap(text: string, width: number, m: Measure): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    const words = para.split(/\s+/).filter((w) => w !== "");
    if (words.length === 0) {
      continue;
    }
    const [space, ...ws] = m.widths([" ", ...words]);
    let line = "";
    let used = 0;
    words.forEach((word, i) => {
      let w = ws[i];
      let rest = word;
      if (w > width) {
        // Cut a long word by characters.
        const chars = [...word];
        const cw = m.widths(chars);
        if (line) {
          out.push(line);
          line = "";
          used = 0;
        }
        let chunk = "";
        let chunkW = 0;
        chars.forEach((ch, k) => {
          if (chunk && chunkW + cw[k] > width) {
            out.push(chunk);
            chunk = "";
            chunkW = 0;
          }
          chunk += ch;
          chunkW += cw[k];
        });
        rest = chunk;
        w = chunkW;
      }
      if (line && used + space + w > width) {
        out.push(line);
        line = "";
        used = 0;
      }
      line = line ? `${line} ${rest}` : rest;
      used = used ? used + space + w : w;
    });
    if (line) {
      out.push(line);
    }
  }
  return out;
}

export interface Layout {
  ops: SceneOp[];
  width: number;
  height: number;
}

/** How many operations laying out `table` takes. */
export function opCount(table: ParsedTable): number {
  const cols = table.rows[0].length;
  const texts = table.rows.reduce(
    (n, r) => n + r.filter((c) => c.trim() !== "").length,
    0,
  );
  // texts, grid lines, the header shade, the outline and the group
  return (
    texts + (table.rows.length - 1) + (cols - 1) + (table.header ? 1 : 0) + 2
  );
}

/** The scene operations of `table` with its top-left corner at (x, y). */
export function layoutTable(
  table: ParsedTable,
  style: Style,
  m: Measure,
  x: number,
  y: number,
): Layout {
  const { rows, header } = table;
  const cols = rows[0].length;
  const inner = Math.max(20, style.maxColWidth - 2 * PAD);
  // Column widths from the natural width of each cell's longest paragraph.
  const natural = new Array<number>(cols).fill(0);
  rows.forEach((r) =>
    r.forEach((cell, c) => {
      const lines = cell.split(/\r?\n/).filter((l) => l.trim() !== "");
      if (lines.length) {
        const w = m.widths(lines.map((l) => l.trim().replace(/\s+/g, " ")));
        natural[c] = Math.max(natural[c], ...Array.from(w));
      }
    }),
  );
  const colW = natural.map(
    (w) => Math.ceil(Math.min(Math.max(w, 24), inner)) + 2 * PAD,
  );
  const wrapped = rows.map((r) =>
    r.map((cell, c) => wrap(cell, colW[c] - 2 * PAD, m)),
  );
  const lineH = style.fontSize * m.lineHeight;
  const rowH = wrapped.map(
    (r) => Math.ceil(Math.max(1, ...r.map((l) => l.length)) * lineH) + 2 * PAD,
  );
  const width = colW.reduce((a, b) => a + b, 0);
  const height = rowH.reduce((a, b) => a + b, 0);
  const xs = colW.reduce<number[]>((a, w) => [...a, a[a.length - 1] + w], [x]);
  const ys = rowH.reduce<number[]>((a, h) => [...a, a[a.length - 1] + h], [y]);

  const ops: SceneOp[] = [];
  const refs: string[] = [];
  const add = (
    ref: string,
    element: Extract<SceneOp, { op: "add" }>["element"],
  ) => {
    ops.push({ op: "add", ref, element });
    refs.push(ref);
  };
  if (header) {
    add("header", {
      type: "rectangle",
      x,
      y,
      width,
      height: rowH[0],
      backgroundColor: HEADER_FILL,
      fillStyle: "solid",
      strokeColor: "transparent",
      roundness: "sharp",
    });
  }
  add("outline", {
    type: "rectangle",
    x,
    y,
    width,
    height,
    strokeColor: style.strokeColor,
    backgroundColor: "transparent",
    roundness: "sharp",
  });
  for (let c = 1; c < cols; c++) {
    add(`v${c}`, {
      type: "line",
      x: xs[c],
      y,
      points: [
        [0, 0],
        [0, height],
      ],
      strokeColor: style.strokeColor,
    });
  }
  for (let r = 1; r < rows.length; r++) {
    add(`h${r}`, {
      type: "line",
      x,
      y: ys[r],
      points: [
        [0, 0],
        [width, 0],
      ],
      strokeColor: style.strokeColor,
      // The rule under the header is heavier: Excalidraw text has no bold weight.
      ...(header && r === 1 ? { strokeWidth: 2 } : {}),
    });
  }
  wrapped.forEach((r, ri) =>
    r.forEach((lines, c) => {
      if (lines.length) {
        add(`t${ri}_${c}`, {
          type: "text",
          x: xs[c] + PAD,
          y: ys[ri] + PAD,
          text: lines.join("\n"),
          fontSize: style.fontSize,
          fontFamily: style.fontFamily,
          strokeColor: style.strokeColor,
        });
      }
    }),
  );
  ops.push({ op: "group", ids: refs.map((ref) => ({ ref })) });
  return { ops, width, height };
}
