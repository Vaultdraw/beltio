// toolbar-demo: a button over the canvas.
// [[contributes.toolbar]] adds a button that runs one of the plugin's commands, so the
// action is also in the palette and can be given a key. The app draws the button without
// loading this code; the code loads on the first click.
import { definePlugin } from "@vaultdraw/api";

export default definePlugin({
  activate(ctx) {
    let clicks = 0;
    ctx.commands.register("count", () => {
      clicks += 1;
      ctx.ui.toast(`Clicked ${clicks} time${clicks === 1 ? "" : "s"}`);
    });
  },
});
