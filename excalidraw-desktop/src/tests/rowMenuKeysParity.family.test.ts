import { describe, expect, it } from "vitest";

import { buildRowMenu } from "../components/menu/rowMenuModel";
import { TREE_ACTIONS, treeActions } from "../components/tree/treeKeys";

import type { MenuNode } from "../components/menu/menuModel";
import type { TreeKeyDeps } from "../components/tree/treeKeys";
import type { EntryKind, VaultEntry } from "../vault/types";

/**
 * Family sweep (validator, 2026-10-30, V-2): "a file-tree row offers the same items from the
 * keyboard (the `list.*` commands in the palette) as from its right-click menu", for every kind
 * of row and read-only state. `treeKeys.ts rowMenuActions` says "Same conditions as the row menu",
 * but it binds Duplicate, Save as template, History, Local graph and Export for every non-folder,
 * while the menu shows them only for drawings. On a note or an Obsidian drawing the palette then
 * offers "Duplicate item", which fails with "Only .excalidraw files can be read as drawings" (note)
 * or, since 73d05967, "Drawing filenames must end in .excalidraw" (Obsidian drawing).
 *
 * Each row: the menu's `list.*` command ids versus the tree actions offered for the focused row.
 * Rows marked KNOWN are broken today (it.fails); they turn red when fixed: drop them from KNOWN.
 */
const noop = () => {};

const ROW_ACTIONS = {
  duplicate: noop,
  saveAsTemplate: noop,
  reveal: noop,
  showAsGrid: noop,
  localGraph: noop,
  history: noop,
  export: noop,
  copyPath: noop,
};

const MENU_ACTIONS = {
  newInside: noop,
  duplicate: noop,
  saveAsTemplate: noop,
  rename: noop,
  move: noop,
  reveal: noop,
  exportAs: noop,
  trash: noop,
  localGraph: noop,
  history: noop,
  syncAction: noop,
  copyPath: noop,
};

const entryOf = (kind: EntryKind): VaultEntry => {
  const name = {
    folder: "Folder",
    drawing: "Plan.excalidraw",
    note: "Idea.md",
    excalidrawMd: "Sketch.excalidraw.md",
  }[kind];
  return { path: `Sub/${name}`, name, kind, modifiedAt: 0, size: 0 };
};

const commandIds = (nodes: readonly MenuNode[], out = new Set<string>()) => {
  for (const node of nodes) {
    if (node.kind === "item" && node.commandId?.startsWith("list.")) {
      out.add(node.commandId.slice("list.".length));
    } else if (node.kind === "submenu") {
      commandIds(node.items, out);
    }
  }
  return out;
};

// The row-specific actions only: navigation (down, open, exit ...) is not a menu item, and New
// drawing / New folder from the keyboard create beside a focused file (in its folder) on purpose.
const ROW_SPECIFIC = new Set<string>([
  "rename",
  "delete",
  "move",
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
  "copyPath",
  "copyAbsolutePath",
  "copyLink",
]);
// Offered from the keyboard without a menu item on purpose: "trash" is the menu's Delete
// (commandId list.delete is not set on it); "showAsGrid" comes from the Gallery plugin's menu
// item, which this table does not enable.
const MENU_ALIASES: Record<string, string> = { trash: "delete" };

const keyActions = (entry: VaultEntry, readOnly: boolean) => {
  const deps: TreeKeyDeps = {
    rows: [{ entry, depth: 0, expanded: false }],
    focusedPath: entry.path,
    activePath: null,
    readOnly,
    dragging: false,
    setFocusedPath: noop,
    expand: noop,
    toggle: noop,
    open: noop,
    rename: noop,
    trash: noop,
    move: noop,
    create: noop,
    menu: noop,
    exit: noop,
    row: ROW_ACTIONS,
  };
  const actions = treeActions(deps);
  return new Set(
    TREE_ACTIONS.filter(
      (a) => ROW_SPECIFIC.has(a) && a !== "showAsGrid" && actions[a],
    ),
  );
};

const menuActions = (entry: VaultEntry, readOnly: boolean) => {
  const menu = buildRowMenu({
    entry,
    readOnly,
    actions: MENU_ACTIONS,
    pluginItems: [],
  });
  const ids = commandIds(menu);
  // items without a commandId that still have a keyboard twin
  const walk = (nodes: readonly MenuNode[]) => {
    for (const node of nodes) {
      if (node.kind === "item" && MENU_ALIASES[node.id]) {
        ids.add(MENU_ALIASES[node.id]);
      } else if (node.kind === "submenu") {
        walk(node.items);
      }
    }
  };
  walk(menu);
  return new Set([...ids].filter((a) => ROW_SPECIFIC.has(a)));
};

const sorted = (s: Set<string>) => [...s].sort();

// kind/readOnly rows broken today: the keyboard offers drawing-only items for these kinds.
const KNOWN = new Set<string>([]);

const ROWS: Array<[EntryKind, boolean]> = (
  ["folder", "drawing", "note", "excalidrawMd"] as const
).flatMap((kind) => [
  [kind, false],
  [kind, true],
]);

describe("family: a tree row's keyboard items match its menu items", () => {
  for (const [kind, readOnly] of ROWS) {
    const label = `${kind}/${readOnly ? "read-only" : "writable"}`;
    const run = KNOWN.has(label) ? it.fails : it;
    run(`${label}: palette list.* items = right-click menu items`, () => {
      const entry = entryOf(kind);
      expect(sorted(keyActions(entry, readOnly))).toEqual(
        sorted(menuActions(entry, readOnly)),
      );
    });
  }
});
