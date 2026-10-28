/**
 * Finds a table in pasted text: a Markdown pipe table, tab-separated values (what a spreadsheet
 * copies) or CSV (comma or semicolon). Pure: no host calls. `parseTable` is conservative, since in
 * `ask` mode a wrong guess is only a toast, but in `always` mode it replaces the user's paste.
 */
export type Delimiter = "pipe" | "tab" | "comma" | "semicolon";

export interface ParsedTable {
  /** Every row has the same number of cells (short rows are padded with ""). */
  rows: string[][];
  delimiter: Delimiter;
  /** The first row is a header (CSV and TSV always; Markdown when it has the `---` line). */
  header: boolean;
}

export const LIMITS = { rows: 200, cols: 30, textChars: 256_000 };

const CHAR: Record<Exclude<Delimiter, "pipe">, string> = {
  tab: "\t",
  comma: ",",
  semicolon: ";",
};

/** Splits text on `sep` with RFC 4180 quotes ("a, b", "" for a quote, quoted line breaks). */
export function splitDelimited(
  text: string,
  sep: string,
  maxRows = Infinity,
): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let atStart = true;
  const endField = () => {
    row.push(field);
    field = "";
    atStart = true;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length && rows.length < maxRows; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"' && atStart) {
      quoted = true;
      atStart = false;
    } else if (c === sep) {
      endField();
    } else if (c === "\n" || (c === "\r" && text[i + 1] === "\n")) {
      if (c === "\r") {
        i++;
      }
      endRow();
    } else {
      field += c;
      atStart = false;
    }
  }
  if (rows.length < maxRows && (field !== "" || row.length > 0)) {
    endRow();
  }
  return rows;
}

const blank = (row: string[]) => row.every((c) => c.trim() === "");

/** Rows made rectangular: true when most rows already had the same width (>= 2 cells). */
function rectangular(rows: string[][], strict: boolean): string[][] | null {
  const live = rows.filter((r) => !blank(r));
  if (live.length < 2) {
    return null;
  }
  const counts = new Map<number, number>();
  for (const r of live) {
    counts.set(r.length, (counts.get(r.length) ?? 0) + 1);
  }
  let mode = 0;
  let n = 0;
  for (const [width, count] of counts) {
    if (count > n) {
      mode = width;
      n = count;
    }
  }
  const need = strict ? live.length : Math.ceil(live.length * 0.8);
  if (mode < 2 || n < need) {
    return null;
  }
  let width = 0;
  for (const r of live) {
    width = Math.max(width, r.length); // a loop: a spread of many rows overflows the call stack
  }
  return live.map((r) => [
    ...r.map((c) => c.trim()),
    ...Array(width - r.length).fill(""),
  ]);
}

const SEPARATOR = /^\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?$/;

/** The cells of one pipe line; `\|` is a pipe inside a cell, the outer pipes are not cells. */
export function splitPipeRow(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\" && line[i + 1] === "|") {
      cell += "|";
      i++;
    } else if (line[i] === "|") {
      cells.push(cell);
      cell = "";
    } else {
      cell += line[i];
    }
  }
  cells.push(cell);
  const t = line.trim();
  if (t.startsWith("|")) {
    cells.shift();
  }
  if (t.endsWith("|") && !t.endsWith("\\|")) {
    cells.pop();
  }
  return cells.map((c) => c.trim());
}

function parseMarkdown(text: string): ParsedTable | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .slice(0, LIMITS.rows + 2); // past the row limit the table is refused anyway
  if (lines.length < 2 || !lines.every((l) => l.includes("|"))) {
    return null;
  }
  const sep = lines.length >= 2 && SEPARATOR.test(lines[1]) ? 1 : -1;
  const framed = lines.every((l) => l.startsWith("|") && l.endsWith("|"));
  if (sep < 0 && !framed) {
    return null;
  }
  const body = lines.filter((_, i) => i !== sep).map(splitPipeRow);
  const rows = rectangular(body, false);
  return rows && rows[0].length >= 2
    ? { rows, delimiter: "pipe", header: sep >= 0 }
    : null;
}

/** The table in `text`, or null when it does not look like one. */
export function parseTable(text: string): ParsedTable | null {
  if (typeof text !== "string" || text.length > LIMITS.textChars) {
    return null;
  }
  const md = text.includes("|") ? parseMarkdown(text) : null;
  if (md) {
    return md;
  }
  const order: Exclude<Delimiter, "pipe">[] = [];
  if (text.includes("\t")) {
    order.push("tab");
  }
  order.push("comma", "semicolon");
  for (const d of order) {
    if (!text.includes(CHAR[d])) {
      continue;
    }
    const rows = rectangular(
      splitDelimited(text, CHAR[d], LIMITS.rows + 2),
      d !== "tab",
    );
    if (rows) {
      return { rows, delimiter: d, header: true };
    }
  }
  return null;
}
