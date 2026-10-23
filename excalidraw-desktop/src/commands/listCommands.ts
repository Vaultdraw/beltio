/**
 * List and file-tree commands (see listNav.ts). Default keys are Vim-style
 * plus the usual arrows; they apply only while a list has focus (`listFocus`),
 * so the canvas and text fields keep every letter. Rebind under `[hotkeys]`.
 */
import { listCommandId, type ListAction } from "./listNav";

import type { Chord, CommandDefinition } from "./types";

export const FOCUS_TREE_COMMAND_ID = "navigator.focusTree";

const list = (
  action: ListAction,
  title: string,
  keys: Chord[],
  repeat = false,
  mac?: Chord[],
): CommandDefinition => ({
  id: listCommandId(action),
  title: `List: ${title}`,
  category: "Navigator",
  keys: mac ? { default: keys, mac } : { default: keys },
  when: ["listFocus"],
  ...(repeat ? { repeat } : {}),
});

export const LIST_COMMANDS: readonly CommandDefinition[] = [
  list("down", "Move down", ["J", "ArrowDown"], true),
  list("up", "Move up", ["K", "ArrowUp"], true),
  list("first", "Go to first", ["G", "Home"]),
  list("last", "Go to last", ["Shift+G", "End"]),
  list("expand", "Expand folder", ["L", "ArrowRight"]),
  list("collapse", "Collapse folder or go to parent", ["H", "ArrowLeft"]),
  list("open", "Open item", ["Enter", "O", "Space"]),
  list("openInNewTab", "Open item in new tab", ["Mod+Enter"], false, [
    "Mod+Enter",
    "Ctrl+Enter",
  ]),
  list("rename", "Rename item", ["R", "F2"]),
  list("delete", "Delete item", ["D", "Delete", "Backspace"]),
  list("newItem", "New drawing here", ["A"]),
  list("newFolder", "New folder here", ["Shift+A"]),
  list("move", "Move item", ["M"]),
  list("menu", "Show item menu", ["Shift+F10", "ContextMenu"]),
  list("nextView", "Switch view", ["Tab"]),
  list("exit", "Leave list", ["Escape"]),
  {
    id: FOCUS_TREE_COMMAND_ID,
    title: "Navigator: Focus file tree",
    category: "Navigator",
    keys: { default: ["Mod+Alt+F"] },
    when: ["vaultOpen", "!modalOpen"],
  },
];
