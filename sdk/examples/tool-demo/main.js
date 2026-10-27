// tool-demo: a canvas tool.
// [[contributes.tools]] adds a toolbar button and the palette command "Tool: Box". The
// app shows both without loading this code; it loads when the tool is first chosen.
// While the tool is active the pointer comes here (scene coordinates): press, drag,
// release draws one box in one undo step.
import { definePlugin } from "@vaultdraw/api";

export default definePlugin({
  activate(ctx) {
    let start = null;
    ctx.tools.register("box", {
      pointerDown(p) {
        start = p;
      },
      async pointerUp(p) {
        if (!start) {
          return;
        }
        const from = start;
        start = null;
        const width = Math.abs(p.x - from.x);
        const height = Math.abs(p.y - from.y);
        if (width < 4 && height < 4) {
          return; // a click, not a drag
        }
        await ctx.scene.batch([
          {
            op: "add",
            element: {
              type: "rectangle",
              x: Math.min(p.x, from.x),
              y: Math.min(p.y, from.y),
              width,
              height,
            },
          },
        ]);
      },
      cancel() {
        start = null;
      },
    });
  },
});
