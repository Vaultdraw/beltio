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
/** A column is never narrower than this (padding included), unless the table has so many columns
 * that they cannot all have it; then every column gets an equal share and thinner padding. */
const MIN_COL = 3 * CELL_PAD_X;
/** The thinnest cell padding, for tables with very many columns. */
const MIN_PAD_X = 2;

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
  /** Room left and right of each cell's text (thinner for tables with very many columns). */
  padX: number;
  /** The first row is a header (shaded). */
  header: boolean;
  role: Role;
  /** The role of a bold cell, and which cells (`[row][col]`, header first) are bold. */
  boldRole?: Role;
  bold?: readonly (readonly boolean[])[];
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
  boldRole?: Role,
  boldCells?: readonly (readonly boolean[])[],
): TableGrid => {
  const roleAt = (r: number, c: number): Role =>
    boldRole && boldCells?.[r]?.[c] ? boldRole : role;
  const cols = Math.max(head.length, ...body.map((r) => r.length), 1);
  const rows: string[][] = (head.length ? [head, ...body] : [...body]).map(
    (r) => Array.from({ length: cols }, (_, c) => flat(r[c])),
  );
  const natural = new Array<number>(cols).fill(0);
  const word = new Array<number>(cols).fill(0);
  rows.forEach((r, ri) => {
    r.forEach((cell, c) => {
      if (cell === "") {
        return;
      }
      const cellRole = roleAt(ri, c);
      natural[c] = Math.max(natural[c], wrapper.width(cell, cellRole));
      for (const w of cell.split(" ")) {
        word[c] = Math.max(word[c], wrapper.width(w, cellRole));
      }
    });
  });
  // So many columns that even the narrowest ones overflow: equal shares, thinner padding.
  const share = Math.floor(maxWidth / cols);
  const minCol = Math.min(MIN_COL, share);
  const padX =
    minCol < MIN_COL ? Math.max(MIN_PAD_X, Math.floor(minCol / 6)) : CELL_PAD_X;
  const want = natural.map((w) => Math.max(minCol, Math.ceil(w) + 2 * padX));
  const least = word.map((w, c) =>
    Math.min(want[c], Math.max(minCol, Math.ceil(w) + 2 * padX)),
  );
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  let colW: number[];
  if (sum(want) <= maxWidth) {
    colW = want;
  } else if (sum(least) >= maxWidth) {
    // Even the longest words do not fit: shrink every column by the same factor (never under
    // the minimum, which fits by construction); long words then break by character.
    const k = maxWidth / sum(least);
    colW = least.map((w) => Math.max(minCol, Math.floor(w * k)));
    let over = sum(colW) - maxWidth;
    for (let c = 0; over > 0 && c < cols; c = (c + 1) % cols) {
      if (colW[c] > minCol) {
        colW[c]--;
        over--;
      } else if (colW.every((w) => w <= minCol)) {
        break;
      }
    }
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
  const lines = rows.map((r, ri) =>
    r.map((cell, c) =>
      cell === "" ? [] : wrapper.lines(cell, roleAt(ri, c), colW[c] - 2 * padX),
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
    padX,
    header: head.length > 0,
    role,
    ...(boldRole && boldCells ? { boldRole, bold: boldCells } : {}),
  };
};
