/**
 * The graph's command ids (`graph.<short id>`, the same ids the app has always used, so saved key
 * bindings keep working). The commands, titles, default keys and `when` clauses are declared in
 * plugin.toml; this file names them for the code.
 */
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
  // command audit (S8): toolbar and settings-panel actions of the open view
  toggleArrows: "graph.toggleArrows",
  toggleColourBy: "graph.toggleColourBy",
  toggleSettings: "graph.toggleSettings",
  resetDisplay: "graph.resetDisplay",
} as const;

export const GRAPH_VIEW_IDS: readonly string[] = [
  ...Object.values(GRAPH_VIEW_COMMAND_IDS),
  GRAPH_COMMAND_IDS.fit, // host-bound; the view overrides it only during hints
];
