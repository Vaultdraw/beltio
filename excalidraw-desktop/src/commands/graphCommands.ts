/**
 * The graph's command ids the app itself refers to (its entry points in the navigator, main menu
 * and row menu run them). The commands, titles and keys belong to the official graph plugin
 * (plugins/official/graph/plugin.toml); the ids are the ones the app has always used, so saved
 * key bindings keep working. Without the plugin enabled no handler exists, so nothing runs.
 */
export const GRAPH_COMMAND_IDS = {
  open: "graph.open",
  openLocal: "graph.openLocal",
} as const;
