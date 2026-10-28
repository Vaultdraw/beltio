/**
 * Context-menu model: plain data the renderer (ContextMenu.tsx) draws.
 * Pure and React-free, so grouping and type-ahead are unit-tested.
 */
export type MenuNode =
  | {
      kind: "item";
      id: string;
      label: string;
      /** A `list.*` (or other) command whose live key is shown on the right. */
      commandId?: string;
      danger?: boolean;
      run: () => void;
    }
  | {
      kind: "submenu";
      id: string;
      label: string;
      items: MenuNode[];
    }
  | { kind: "separator" };

export const SEPARATOR: MenuNode = { kind: "separator" };

/**
 * Join groups with one separator between non-empty groups: leading, trailing
 * and doubled dividers never appear, whatever a group filters out.
 */
export function joinGroups(
  groups: readonly (readonly MenuNode[])[],
): MenuNode[] {
  const out: MenuNode[] = [];
  for (const group of groups) {
    const items = group.filter(
      (n) => n.kind !== "submenu" || n.items.length > 0,
    );
    if (items.length === 0) {
      continue;
    }
    if (out.length > 0) {
      out.push(SEPARATOR);
    }
    out.push(...items);
  }
  return out;
}

/**
 * Type-ahead: the index of the next label (after `from`, wrapping) that starts
 * with `typed`, ignoring case; -1 when none. A repeated single letter cycles.
 */
export function typeAheadIndex(
  labels: readonly string[],
  from: number,
  typed: string,
): number {
  const needle = typed.toLowerCase();
  if (!needle || labels.length === 0) {
    return -1;
  }
  const cycle = needle.length > 1 && [...needle].every((c) => c === needle[0]);
  const prefix = cycle ? needle[0] : needle;
  // A growing prefix may stay on the current item; a single letter moves on.
  const first = prefix.length > 1 ? from : from + 1;
  for (let i = 0; i < labels.length; i++) {
    const index =
      (((first + i) % labels.length) + labels.length) % labels.length;
    if (labels[index].toLowerCase().startsWith(prefix)) {
      return index;
    }
  }
  return -1;
}
