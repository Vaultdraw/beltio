/**
 * A Markdown table as a real grid: column widths from the content, cells wrapped (never cut),
 * one row per paginator entry so a long table breaks between rows. Pure: the wrapper measures.
 *
 * Widths: every column gets its natural width (its widest cell on one line) when the table fits
 * the frame. When it does not, each column keeps at least its longest word and the rest of the
 * frame is shared by how much more each column wants. A table too narrow even for that is
 * scaled down and long words break by character, as the editor wraps them.
 */
import type { Role } from "./fonts";
import type { Wrapper } from "./wrap";

/** Room left and right of a cell's text, scene pixels. */
export const CELL_PAD_X = 8;
/** Room above and below a cell's text. */
export const CELL_PAD_Y = 6;
/** A column is never narrower than this (padding included). */
const MIN_COL = 3 * CELL_PAD_X;

export type CellAlign = "left" | "center" | "right";

export interface TableGrid {
  /** Left edge of each column from the table's left edge; one extra entry for the right edge. */
  colX: number[];
  width: number;
  align: CellAlign[];
  /** `lines[row][col]`: the wrapped lines of a cell (empty for a blank cell). */
  lines: string[][][];
  /** Row heights, padding included. */
  rowH: number[];
  /** The first row is a header (shaded). */
  header: boolean;
  role: Role;
}

const flat = (s: string | undefined): string =>
  (s ?? "").replace(/\s+/g, " ").trim();

export const gridOf = (
  head: readonly string[],
  body: readonly (readonly string[])[],
  align: readonly string[],
  wrapper: Wrapper,
  role: Role,
  maxWidth: number,
): TableGrid => {
  const cols = Math.max(head.length, ...body.map((r) => r.length), 1);
  const rows: string[][] = (head.length ? [head, ...body] : [...body]).map(
    (r) => Array.from({ length: cols }, (_, c) => flat(r[c])),
  );
  const natural = new Array<number>(cols).fill(0);
  const word = new Array<number>(cols).fill(0);
  for (const r of rows) {
    r.forEach((cell, c) => {
      if (cell === "") {
        return;
      }
      natural[c] = Math.max(natural[c], wrapper.width(cell, role));
      for (const w of cell.split(" ")) {
        word[c] = Math.max(word[c], wrapper.width(w, role));
      }
    });
  }
  const want = natural.map((w) => Math.ceil(w) + 2 * CELL_PAD_X);
  const least = word.map((w, c) =>
    Math.min(want[c], Math.max(MIN_COL, Math.ceil(w) + 2 * CELL_PAD_X)),
  );
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  let colW: number[];
  if (sum(want) <= maxWidth) {
    colW = want.map((w) => Math.max(w, MIN_COL));
  } else if (sum(least) >= maxWidth) {
    const k = maxWidth / sum(least);
    colW = least.map((w) => Math.max(MIN_COL, Math.floor(w * k)));
  } else {
    const spare = maxWidth - sum(least);
    const wish = want.map((w, c) => w - least[c]);
    const total = sum(wish);
    colW = least.map((w, c) => w + Math.floor((spare * wish[c]) / total));
  }
  const colX = colW.reduce<number[]>(
    (a, w) => [...a, a[a.length - 1] + w],
    [0],
  );
  const lines = rows.map((r) =>
    r.map((cell, c) =>
      cell === "" ? [] : wrapper.lines(cell, role, colW[c] - 2 * CELL_PAD_X),
    ),
  );
  const rowH = lines.map(
    (r) =>
      Math.max(1, ...r.map((l) => l.length)) * role.linePx + 2 * CELL_PAD_Y,
  );
  return {
    colX,
    width: colX[cols],
    align: Array.from({ length: cols }, (_, c) =>
      align[c] === "center" || align[c] === "right" ? align[c] : "left",
    ) as CellAlign[],
    lines,
    rowH,
    header: head.length > 0,
    role,
  };
};
