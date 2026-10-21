import { definePlugin } from "@vaultdraw/api";

export default definePlugin({
  activate(ctx) {
    ctx.commands.register("hello", () => {
      ctx.ui.toast(`${ctx.settings.get("greeting")} from a plugin`);
    });
  },
});
