import { definePlugin } from "@vaultdraw/api";

export default definePlugin({
  activate(ctx) {
    ctx.commands.register("say", () => {
      globalThis.__smokeHello = "ok";
    });
    ctx.commands.register("boom", () => {
      const err = new Error("smoke boom");
      globalThis.__smokeBoomStack = err.stack;
      throw err;
    });
  },
});
//# sourceMappingURL=main.js.map
/* global globalThis */
