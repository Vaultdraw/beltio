/**
 * Result grouping for the palette: pure, O(n) over the rows rankRows already
 * produced (no second search). Files mode with a query shows the top hit
 * under "Best match", the rest under "Other matches", and a trailing
 * "Create" row for a name nothing matches exactly. Commands mode is flat.
 * The palette's ranking only knows names, so there is no "Also matches text
 * inside" group: content hits live in the navigator search.
 */
import { stripDrawingExt } from "../vault/fileKind";

import type { PaletteMode, RankedRow } from "./rank";

export const createKey = (name: string) => `create:${name}`;

/** Characters that would turn a typed name into a path. */
const NOT_A_NAME = /[\\/:]/;

/** `name` as the file's base name without extension, lower case. */
const baseName = (path: string) =>
  stripDrawingExt(path.slice(path.lastIndexOf("/") + 1)).toLowerCase();

/** Rows plus a Create row when `query` is a fresh, valid drawing name. */
export function withCreateRow(
  rows: RankedRow[],
  query: string,
  mode: PaletteMode,
  enabled: boolean,
): RankedRow[] {
  const name = stripDrawingExt(query.trim());
  if (!enabled || mode !== "files" || !name || NOT_A_NAME.test(name)) {
    return rows;
  }
  const lower = name.toLowerCase();
  for (const row of rows) {
    if (row.kind === "drawing" && baseName(row.drawing.path) === lower) {
      return rows;
    }
  }
  return [
    ...rows,
    { kind: "create", key: createKey(name), name, positions: [] },
  ];
}

/** Heading to draw before each row (null = none); same length as rows. */
export function rowHeadings(
  rows: readonly RankedRow[],
  mode: PaletteMode,
  hasQuery: boolean,
  /** Keys of the recently used rows (listed first when there is no query). */
  recent: readonly string[] = [],
): (string | null)[] {
  const out: (string | null)[] = rows.map(() => null);
  if (mode === "commands") {
    // Browsing (no query): the group once, as a section header, where it
    // changes (VS Code's "recently used / other commands", Raycast's
    // sections), instead of a muted suffix on every row. Ranked results
    // interleave groups, so they get no headers; each title still starts
    // with its group ("Export: PDF").
    if (hasQuery) {
      return out;
    }
    const recentKeys = new Set(recent);
    const groupOf = (row: RankedRow | undefined) =>
      !row || row.kind !== "item"
        ? null
        : recentKeys.has(row.key)
        ? "Recently used"
        : row.entry.item.group;
    rows.forEach((row, i) => {
      const group = groupOf(row);
      const prevGroup = groupOf(rows[i - 1]);
      if (group && group !== prevGroup) {
        out[i] = group;
      }
    });
    return out;
  }
  if (!hasQuery) {
    return out;
  }
  let first = true;
  let other = false;
  rows.forEach((row, i) => {
    if (row.kind === "create") {
      out[i] = "Create";
    } else if (first) {
      out[i] = "Best match";
      first = false;
    } else if (!other) {
      out[i] = "Other matches";
      other = true;
    }
  });
  return out;
}
