/**
 * Navigator sort order: the value type, labels and the comparator. Pure data
 * and functions (no React, no preferences) so the settings schema, the tree
 * builder and tests share one definition.
 */
import { entryDisplayName } from "./fileKind";

import type { VaultEntry } from "./types";

export const SORT_ORDERS = [
  "name_asc",
  "name_desc",
  "modified_desc",
  "modified_asc",
] as const;

export type SortOrder = typeof SORT_ORDERS[number];

export const DEFAULT_SORT_ORDER: SortOrder = "name_asc";

export const isSortOrder = (value: unknown): value is SortOrder =>
  typeof value === "string" &&
  (SORT_ORDERS as readonly string[]).includes(value);

export const SORT_LABELS: Record<SortOrder, string> = {
  name_asc: "Name (A to Z)",
  name_desc: "Name (Z to A)",
  modified_desc: "Modified (new to old)",
  modified_asc: "Modified (old to new)",
};

// One collator: numeric so "Drawing 2" sorts before "Drawing 10".
const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

/**
 * Compare by the name the row shows (without `.excalidraw` / `.md`), so "Untitled" comes before
 * "Untitled 2" as in Zed and Obsidian; the full file name only breaks ties ("Plan.md" and
 * "Plan.excalidraw").
 */
const compareNames = (a: string, b: string): number =>
  collator.compare(entryDisplayName(a), entryDisplayName(b)) ||
  collator.compare(a, b);

/** Folders always come first; `order` applies within folders and among all files together. */
export const compareEntries = (
  a: Pick<VaultEntry, "kind" | "name" | "modifiedAt">,
  b: Pick<VaultEntry, "kind" | "name" | "modifiedAt">,
  order: SortOrder,
): number => {
  // Only a folder against a file is decided by kind; files of different kinds (drawing, note,
  // Obsidian drawing) sort together by the chosen order, as in Obsidian.
  const aFolder = a.kind === "folder";
  if (aFolder !== (b.kind === "folder")) {
    return aFolder ? -1 : 1;
  }
  switch (order) {
    case "name_desc":
      return compareNames(b.name, a.name);
    case "modified_desc":
      return b.modifiedAt - a.modifiedAt || compareNames(a.name, b.name);
    case "modified_asc":
      return a.modifiedAt - b.modifiedAt || compareNames(a.name, b.name);
    default:
      return compareNames(a.name, b.name);
  }
};

/** A sorted copy (the input is never mutated). */
export const sortEntries = (
  entries: readonly VaultEntry[],
  order: SortOrder,
): VaultEntry[] => [...entries].sort((a, b) => compareEntries(a, b, order));
