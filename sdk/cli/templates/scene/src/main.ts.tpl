// A command that adds a labelled box to the open drawing. One scene.batch is ONE undo step.
// batch() rejects when no drawing is open or it is read-only, so the plugin catches that.
import type { Plugin } from "@vaultdraw/api";

const plugin: Plugin = {
  activate(ctx) {
    ctx.commands.register("stamp", async () => {
      const c = ctx.scene.viewportCenter();
      try {
        await ctx.scene.batch([
          {
            op: "add",
            element: {
              type: "rectangle",
              x: c.x - 80,
              y: c.y - 50,
              width: 160,
              height: 100,
              backgroundColor: String(ctx.settings.get("color")),
              text: "Note",
            },
          },
        ]);
      } catch {
        ctx.ui.toast("Open an editable drawing first");
      }
    });
  },
};

export default plugin;
