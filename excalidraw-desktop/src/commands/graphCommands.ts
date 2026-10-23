/**
 * Graph view commands (P3). Handlers are bound by GraphHost; a command
 * without one is simply not offered. The key set is Obsidian's Mod+Alt family
 * (D18); the toggles have no default key. The in-view keys (Vim-style, scoped
 * to `graphFocus`) are rebindable like any command.
 */
import type { CommandDefinition } from "./types";

export const GRAPH_COMMAND_IDS = {
  open: "graph.open",
  openLocal: "graph.openLocal",
  toggleOrphans: "graph.toggleOrphans",
  toggleTags: "graph.toggleTags",
  toggleUnresolved: "graph.toggleUnresolved",
  fit: "graph.fit",
} as const;

/** In-view commands: bound by GraphView while it is open, active only with focus in it. */
export const GRAPH_VIEW_COMMAND_IDS = {
  left: "graph.moveLeft",
  right: "graph.moveRight",
  up: "graph.moveUp",
  down: "graph.moveDown",
  openNode: "graph.openNode",
  filter: "graph.focusFilter",
  toggleLocal: "graph.toggleLocal",
  depth1: "graph.depth1",
  depth2: "graph.depth2",
  depth3: "graph.depth3",
  hints: "graph.hints",
  zoomIn: "graph.zoomIn",
  zoomOut: "graph.zoomOut",
  close: "graph.close",
} as const;

export const GRAPH_VIEW_IDS: readonly string[] = Object.values(
  GRAPH_VIEW_COMMAND_IDS,
);

const VAULT = ["vaultOpen", "!modalOpen"] as const;

const command = (
  id: string,
  title: string,
  keys: string[],
  when: CommandDefinition["when"],
): CommandDefinition => ({
  id,
  title: `Graph: ${title}`,
  category: "Graph",
  keys: { default: keys },
  when,
});

const I = GRAPH_COMMAND_IDS;
const V = GRAPH_VIEW_COMMAND_IDS;
const IN_GRAPH = ["graphFocus", "!modalOpen"] as const;

const view = (
  id: string,
  title: string,
  keys: string[],
  repeat = false,
): CommandDefinition => ({
  ...command(id, title, keys, [...IN_GRAPH]),
  ...(repeat ? { repeat } : {}),
});

export const GRAPH_COMMANDS: CommandDefinition[] = [
  command(I.open, "Open graph view", ["Mod+Alt+G"], [...VAULT]),
  command(
    I.openLocal,
    "Open local graph",
    ["Mod+Alt+L"],
    ["drawingOpen", "!modalOpen"],
  ),
  command(I.toggleOrphans, "Toggle orphans", [], [...VAULT]),
  command(I.toggleTags, "Toggle tags", [], [...VAULT]),
  command(I.toggleUnresolved, "Toggle unresolved links", [], [...VAULT]),
  command(I.fit, "Fit graph to view", ["0"], [...IN_GRAPH]),
  view(V.left, "Focus node to the left", ["H", "ArrowLeft"], true),
  view(V.right, "Focus node to the right", ["L", "ArrowRight"], true),
  view(V.up, "Focus node above", ["K", "ArrowUp"], true),
  view(V.down, "Focus node below", ["J", "ArrowDown"], true),
  view(V.openNode, "Open focused node", ["Enter"]),
  view(V.filter, "Focus the filter", ["Slash"]),
  view(V.toggleLocal, "Switch between global and local graph", ["Shift+L"]),
  view(V.depth1, "Local depth 1", ["1"]),
  view(V.depth2, "Local depth 2", ["2"]),
  view(V.depth3, "Local depth 3", ["3"]),
  view(V.hints, "Show link hints", ["F", "Shift+F"]),
  view(V.zoomIn, "Zoom in", ["Equal", "Shift+Equal"], true),
  view(V.zoomOut, "Zoom out", ["Minus"], true),
  view(V.close, "Close graph", ["Escape"]),
];
