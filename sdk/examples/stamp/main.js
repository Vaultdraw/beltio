// stamp: write to the drawing with ctx.scene.batch.
// Each command is ONE batch = ONE undo step. Text on a shape becomes its bound
// label; arrows are placed with `points`. Positions are relative to the
// viewport centre. batch() rejects when no drawing is open (or it is
// read-only): the plugin catches that and shows a toast instead of throwing.
import { definePlugin } from "@vaultdraw/api";

const BOX = { width: 120, height: 60 };
const GAP = 60;

export default definePlugin({
  activate(ctx) {
    const stamp = async (ops) => {
      try {
        await ctx.scene.batch(ops);
      } catch (err) {
        ctx.ui.toast("Open an editable drawing first");
      }
    };

    ctx.commands.register("note", () => {
      const c = ctx.scene.viewportCenter();
      return stamp([
        {
          op: "add",
          element: {
            type: "rectangle",
            x: c.x - 80,
            y: c.y - 50,
            width: 160,
            height: 100,
            backgroundColor: ctx.settings.get("color"),
            text: "Note",
          },
        },
      ]);
    });

    ctx.commands.register("flow", () => {
      const c = ctx.scene.viewportCenter();
      const step = BOX.width + GAP;
      const x0 = c.x - (3 * BOX.width + 2 * GAP) / 2;
      const y = c.y - BOX.height / 2;
      const boxes = ["Start", "Step", "Done"].map((text, i) => ({
        op: "add",
        element: { type: "rectangle", x: x0 + i * step, y, ...BOX, text },
      }));
      const arrows = [0, 1].map((i) => ({
        op: "add",
        element: {
          type: "arrow",
          x: x0 + i * step + BOX.width,
          y: c.y,
          points: [
            [0, 0],
            [GAP, 0],
          ],
        },
      }));
      return stamp([...boxes, ...arrows]);
    });
  },
});
