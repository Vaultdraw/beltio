import { decodeGraph } from "./decode";

import type { GraphSource } from "./GraphSession";
import type { PluginContext } from "@vaultdraw/api";

/** The graph and its layout cache through the plugin API (`ctx.vault.graph`): raw bytes, no JSON. */
export const pluginGraphSource = (ctx: PluginContext): GraphSource => ({
  async graph() {
    return decodeGraph(await ctx.vault.graph.read());
  },
  loadLayout: () => ctx.vault.graph.layout.load(),
  saveLayout: (_handle, bytes) => ctx.vault.graph.layout.save(bytes),
});
