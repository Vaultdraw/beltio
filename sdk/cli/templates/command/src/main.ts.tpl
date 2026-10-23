// A command, a setting and a toast. Nothing here loads until the command first runs.
// Import only TYPES from "@vaultdraw/api": the app provides the module at run time,
// and your tests do not resolve it.
import type { Plugin } from "@vaultdraw/api";

const plugin: Plugin = {
  activate(ctx) {
    ctx.commands.register("hello", () => {
      ctx.ui.toast(`${ctx.settings.get("greeting")}, Vaultdraw!`);
    });
  },
};

export default plugin;
