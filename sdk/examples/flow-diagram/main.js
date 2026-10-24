// flow-diagram: a connected diagram in ONE ctx.scene.batch (one undo step).
// Each box gets a `ref`; arrows name their ends with `{ ref }`, so Excalidraw
// binds them (move a box and its arrows follow). A `group` op groups the whole
// flow, and each box carries this plugin's own `data` (read back with
// scene.dataOf). The `path` option refuses the write if the user switched to
// another drawing meanwhile. The panel's button and the command do the same.
import { createElement as h } from "react";
import { definePlugin } from "@vaultdraw/api";

const STEPS = ["Idea", "Draft", "Review", "Ship"];
const BOX = { width: 140, height: 70 };
const GAP = 80;

/** The ops for a left-to-right flow centred on `c` (exported for tests). */
export function flowOps(c, steps = STEPS) {
  const x0 = c.x - (steps.length * BOX.width + (steps.length - 1) * GAP) / 2;
  const y = c.y - BOX.height / 2;
  const boxes = steps.map((text, i) => ({
    op: "add",
    ref: `step${i}`,
    element: {
      type: "rectangle",
      x: x0 + i * (BOX.width + GAP),
      y,
      ...BOX,
      text,
      roundness: "round",
      data: { step: i },
    },
  }));
  const arrows = steps.slice(1).map((_, i) => ({
    op: "add",
    ref: `arrow${i}`,
    element: {
      type: "arrow",
      start: { ref: `step${i}` },
      end: { ref: `step${i + 1}` },
    },
  }));
  const group = {
    op: "group",
    ids: [...boxes, ...arrows].map((o) => ({ ref: o.ref })),
  };
  return [...boxes, ...arrows, group];
}

export default definePlugin({
  activate(ctx) {
    const insert = async () => {
      const path = ctx.scene.path();
      if (path === null) {
        ctx.ui.toast("Open a drawing first");
        return null;
      }
      try {
        return await ctx.scene.batch(flowOps(ctx.scene.viewportCenter()), {
          path,
        });
      } catch (err) {
        ctx.ui.toast(
          err && err.code === "READ_ONLY"
            ? "This drawing is read-only"
            : "Could not draw the flow",
        );
        return null;
      }
    };

    function Panel() {
      return h(
        "div",
        { style: { padding: 16 } },
        h(
          "p",
          { style: { marginTop: 0 } },
          "Draws a four-step flow on the open drawing.",
        ),
        h("button", { type: "button", onClick: insert }, "Insert flow"),
      );
    }

    ctx.panels.register("flow", Panel);
    ctx.commands.register("insert", insert);
  },
});
