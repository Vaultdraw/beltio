/**
 * The file tree's keyboard actions as a ListController (commands/listNav.ts):
 * the `list.*` commands call these, so every key is rebindable in `[hotkeys]`.
 * Pure over a snapshot of the tree's state; the navigator rebuilds it per
 * render and the registered controller reads the latest one.
 */
import { getParentPath } from "../../vault/treeStore";

import type { ListAction } from "../../commands/listNav";
import type { VaultEntry } from "../../vault/types";
import type { TreeRow } from "./flattenTree";

export interface TreeKeyDeps {
  rows: readonly TreeRow[];
  focusedPath: string | null;
  /** The open drawing: the cursor starts there when nothing is focused. */
  activePath: string | null;
  readOnly: boolean;
  setFocusedPath(path: string): void;
  expand(folder: string): void;
  /** Toggle a folder open/closed. */
  toggle(folder: string): void;
  open(path: string, newTab: boolean): void;
  rename(entry: VaultEntry): void;
  trash(entry: VaultEntry): void;
  move(entry: VaultEntry): void;
  create(parentFolder: string, kind: "drawing" | "folder"): void;
  menu(entry: VaultEntry): void;
  exit(): void;
}

/** Everything the tree implements (it has no second view: Tab leaves it). */
export type TreeAction = Exclude<ListAction, "nextView">;

export const TREE_ACTIONS: readonly TreeAction[] = [
  "down",
  "up",
  "first",
  "last",
  "expand",
  "collapse",
  "open",
  "openInNewTab",
  "rename",
  "delete",
  "newItem",
  "newFolder",
  "move",
  "menu",
  "exit",
];

export function treeActions(d: TreeKeyDeps): Record<TreeAction, () => void> {
  const { rows } = d;
  const index = rows.findIndex(
    (r) => r.entry.path === (d.focusedPath ?? d.activePath),
  );
  const row = index >= 0 ? rows[index] : undefined;
  const item = row?.entry;
  const go = (i: number) => {
    if (rows.length > 0) {
      d.setFocusedPath(rows[(i + rows.length) % rows.length].entry.path);
    }
  };
  const writable = (fn: (entry: VaultEntry) => void) => () => {
    if (item && !d.readOnly) {
      fn(item);
    }
  };
  // New items go in the focused folder, else beside the focused drawing.
  const createIn = (kind: "drawing" | "folder") => () => {
    if (d.readOnly) {
      return;
    }
    const folder = !item
      ? ""
      : item.kind === "folder"
      ? item.path
      : getParentPath(item.path) ?? "";
    d.create(folder, kind);
  };
  const activate = (newTab: boolean) => () => {
    if (!item) {
      go(0);
    } else if (item.kind === "folder") {
      d.setFocusedPath(item.path);
      d.toggle(item.path);
    } else {
      d.setFocusedPath(item.path);
      d.open(item.path, newTab);
    }
  };

  return {
    down: () => go(index < 0 ? 0 : index + 1),
    up: () => go(index < 0 ? rows.length - 1 : index - 1),
    first: () => go(0),
    last: () => go(rows.length - 1),
    // Folder: open it, or step into its first child when already open.
    expand: () => {
      if (row?.entry.kind !== "folder") {
        return;
      }
      if (!row.expanded) {
        d.setFocusedPath(row.entry.path);
        d.expand(row.entry.path);
      } else if (rows[index + 1]?.depth > row.depth) {
        go(index + 1);
      }
    },
    // Open folder: close it; anything else: go to the parent folder.
    collapse: () => {
      if (!row) {
        return;
      }
      if (row.entry.kind === "folder" && row.expanded) {
        d.setFocusedPath(row.entry.path);
        d.toggle(row.entry.path);
        return;
      }
      const parent = getParentPath(row.entry.path);
      if (parent) {
        d.setFocusedPath(parent);
      }
    },
    open: activate(false),
    openInNewTab: activate(true),
    rename: writable(d.rename),
    delete: writable(d.trash),
    move: writable(d.move),
    newItem: createIn("drawing"),
    newFolder: createIn("folder"),
    menu: () => {
      if (item) {
        d.menu(item);
      }
    },
    exit: d.exit,
  };
}
