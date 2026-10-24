/**
 * The file tree's keyboard actions as a ListController (commands/listNav.ts):
 * the `list.*` commands call these, so every key is rebindable in `[hotkeys]`.
 * Pure over a snapshot of the tree's state, computed only when a command
 * asks (lazyTreeController), never per render.
 *
 * Safety: rename, delete, move and the menu need a focused row. With none,
 * they are not offered (the key passes, the palette hides them), even while
 * a drawing is open: navigation may start at the open drawing, edits never.
 * The row menu's other items (duplicate, export ...) follow the same rule.
 */
import { getParentPath } from "../../vault/treeStore";

import type { ListAction } from "../../commands/listNav";
import type { ExplorerExportFormat } from "../../export/exportFromFile";
import type { VaultEntry } from "../../vault/types";
import type { TreeRow } from "./flattenTree";

export interface TreeKeyDeps {
  rows: readonly TreeRow[];
  focusedPath: string | null;
  /** The open drawing: the cursor starts there when nothing is focused. */
  activePath: string | null;
  readOnly: boolean;
  /** A row is being dragged: Escape belongs to the drag. */
  dragging: boolean;
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
  /** Row menu items (command audit S8); absent = not offered. */
  row?: TreeRowActions;
}

/** The row menu's items, each taking the focused row's path. */
export interface TreeRowActions {
  duplicate(path: string): void;
  reveal(path: string): void;
  showAsGrid(path: string): void;
  saveAsTemplate?(path: string): void;
  localGraph?(path: string): void;
  history?(path: string): void;
  export?(path: string, format: ExplorerExportFormat): void;
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
  "select",
  "openInNewTab",
  "rename",
  "delete",
  "newItem",
  "newFolder",
  "move",
  "menu",
  "exit",
  "duplicate",
  "saveAsTemplate",
  "reveal",
  "showAsGrid",
  "localGraph",
  "history",
  "exportPng",
  "exportSvg",
  "exportPdf",
  "saveCopy",
];

/**
 * The folder a new item goes in: `path` itself when it is a folder, else its
 * parent; the vault root when there is no path. Shared with the palette's
 * "New drawing in selected folder".
 */
export function targetFolder(
  path: string | null,
  isFolder: (path: string) => boolean,
): string {
  if (!path) {
    return "";
  }
  return isFolder(path) ? path : getParentPath(path) ?? "";
}

type TreeActions = Partial<Record<TreeAction, () => void>>;

export function treeActions(d: TreeKeyDeps): TreeActions {
  const { rows } = d;
  const indexOf = (path: string | null) =>
    path === null ? -1 : rows.findIndex((r) => r.entry.path === path);
  const index = indexOf(d.focusedPath);
  const row = index >= 0 ? rows[index] : undefined;
  const item = row?.entry;
  // Where navigation starts without a focused row: the open drawing.
  const cursor = index >= 0 ? index : indexOf(d.activePath);
  const go = (i: number) => {
    if (rows.length > 0) {
      d.setFocusedPath(rows[(i + rows.length) % rows.length].entry.path);
    }
  };
  const start = () => go(cursor < 0 ? 0 : cursor);
  const onRow = (fn: (row: TreeRow) => void) => () => row ? fn(row) : start();
  const edit = (fn: (entry: VaultEntry) => void) =>
    item && !d.readOnly ? () => fn(item) : undefined;
  const createIn = (kind: "drawing" | "folder") =>
    d.readOnly
      ? undefined
      : () =>
          d.create(
            targetFolder(
              d.focusedPath ?? d.activePath,
              (p) => rows[indexOf(p)]?.entry.kind === "folder",
            ),
            kind,
          );
  const activate = (newTab: boolean) =>
    onRow(({ entry }) => {
      if (entry.kind === "folder") {
        d.toggle(entry.path);
      } else {
        d.open(entry.path, newTab);
      }
    });

  return {
    down: () => go(cursor < 0 ? 0 : cursor + 1),
    up: () => go(cursor < 0 ? rows.length - 1 : cursor - 1),
    first: () => go(0),
    last: () => go(rows.length - 1),
    // Folder: open it, or step into its first child when already open.
    expand: onRow((r) => {
      if (r.entry.kind !== "folder") {
        return;
      }
      if (!r.expanded) {
        d.expand(r.entry.path);
      } else if (rows[index + 1]?.depth > r.depth) {
        go(index + 1);
      }
    }),
    // Open folder: close it; anything else: go to the parent folder.
    collapse: onRow((r) => {
      if (r.entry.kind === "folder" && r.expanded) {
        d.toggle(r.entry.path);
        return;
      }
      const parent = getParentPath(r.entry.path);
      if (parent) {
        d.setFocusedPath(parent);
      }
    }),
    open: activate(false),
    select: activate(false),
    openInNewTab: activate(true),
    rename: edit(d.rename),
    delete: edit(d.trash),
    move: edit(d.move),
    newItem: createIn("drawing"),
    newFolder: createIn("folder"),
    menu: item ? () => d.menu(item) : undefined,
    exit: d.dragging ? undefined : d.exit,
    ...rowMenuActions(item, d),
  };
}

/** Same conditions as the row menu (VaultNavigator RowMenu). */
function rowMenuActions(
  item: VaultEntry | undefined,
  d: TreeKeyDeps,
): TreeActions {
  const r = d.row;
  if (!item || !r) {
    return {};
  }
  const { path } = item;
  const bind = (fn: ((path: string) => void) | undefined, when = true) =>
    fn && when ? () => fn(path) : undefined;
  if (item.kind === "folder") {
    return { reveal: bind(r.reveal), showAsGrid: bind(r.showAsGrid) };
  }
  const exportAs = (format: ExplorerExportFormat) =>
    r.export ? () => r.export?.(path, format) : undefined;
  return {
    duplicate: bind(r.duplicate, !d.readOnly),
    saveAsTemplate: bind(r.saveAsTemplate),
    reveal: bind(r.reveal),
    localGraph: bind(r.localGraph),
    history: bind(r.history),
    exportPng: exportAs("png"),
    exportSvg: exportAs("svg"),
    exportPdf: exportAs("pdf"),
    saveCopy: exportAs("copy"),
  };
}

/**
 * A stable ListController over `deps` (a ref updated each render): each
 * getter computes the actions only when the dispatcher or palette asks.
 */
export function lazyTreeController(deps: {
  readonly current: TreeKeyDeps | null;
}): TreeActions {
  const controller: TreeActions = {};
  for (const action of TREE_ACTIONS) {
    Object.defineProperty(controller, action, {
      enumerable: true,
      get: () => (deps.current ? treeActions(deps.current)[action] : undefined),
    });
  }
  return controller;
}
