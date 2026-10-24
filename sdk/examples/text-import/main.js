// text-import: an importer. plugin.toml declares the file type, so Vaultdraw
// loads this file only when a .txt file is dropped on the canvas or picked in
// "Import: File…". Returning { ops } makes the result ONE undo step at the
// drop point (opts.at). Returning nothing would mean the plugin did its own work.
import { definePlugin } from "@vaultdraw/api";

export default definePlugin({
  activate(ctx) {
    ctx.importers.register("txt", {
      async import(input, opts) {
        const text = (await input.text()).trimEnd();
        if (!text) {
          ctx.ui.toast(`${input.name} is empty`);
          return;
        }
        return {
          ops: [
            {
              op: "add",
              element: { type: "text", x: opts.at.x, y: opts.at.y, text },
            },
          ],
        };
      },
    });
  },
});
