// menu-demo: items in the right-click menus.
// [[contributes.menus]] adds an item to a menu and runs one of the plugin's commands,
// so the item is also in the palette. The app shows the items without loading this
// code; it loads when an item is chosen. ctx.menus.target() says where.
import { definePlugin } from "@vaultdraw/api";

export default definePlugin({
  activate(ctx) {
    ctx.commands.register("where", () => {
      const t = ctx.menus.target();
      if (!t) {
        ctx.ui.toast("Not from a menu (palette or key)");
        return;
      }
      const at = t.at ? ` at ${Math.round(t.at.x)},${Math.round(t.at.y)}` : "";
      ctx.ui.toast(`${t.surface}: ${t.path ?? "(no file)"}${at}`);
    });
  },
});
