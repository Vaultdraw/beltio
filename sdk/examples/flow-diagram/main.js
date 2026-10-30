// flow-diagram: a connected diagram in ONE ctx.scene.batch (one undo step).
// Each box gets a `ref`; arrows name their ends with `{ ref }`, so Excalidraw
// binds them (move a box and its arrows follow). A `group` op groups the whole
// flow, and each box carries this plugin's own `data` (read back with
// scene.dataOf). The `path` option refuses the write if the user switched to
// another drawing meanwhile. The panel's button and the command do the same.
// "Add a step" (API 0.9.0) extends a flow already on the canvas: its arrow
// starts at the last box with `{ id }`, an element that is not in the batch.
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

/**
 * The ops for one more step after `last` (a box on the canvas whose data is
 * `{ step }`): a new box to its right and an arrow bound to both (exported for
 * tests).
 */
export function stepOps(last, step) {
  return [
    {
      op: "add",
      ref: "next",
      element: {
        type: "rectangle",
        x: last.x + last.width + GAP,
        y: last.y,
        width: last.width,
        height: last.height,
        text: `Step ${step + 1}`,
        roundness: "round",
        data: { step },
      },
    },
    {
      op: "add",
      ref: "link",
      element: { type: "arrow", start: { id: last.id }, end: { ref: "next" } },
    },
    // Grouping with the last box takes its whole flow along, so the longer
    // flow still moves as one.
    { op: "group", ids: [last.id, { ref: "next" }, { ref: "link" }] },
  ];
}

/** `{ id }` ends need plugin API 0.9.0 or later. */
const canBindToCanvas = (revision) => {
  const [major, minor] = String(revision).split(".").map(Number);
  return major > 0 || minor >= 9;
};

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

    const addStep = async () => {
      const path = ctx.scene.path();
      if (path === null) {
        ctx.ui.toast("Open a drawing first");
        return null;
      }
      // The flow's last box: the highest step in this plugin's data.
      let last = null;
      let lastStep = -1;
      for (const el of ctx.scene.elements()) {
        const data = el.type === "rectangle" ? ctx.scene.dataOf(el.id) : null;
        if (data && typeof data.step === "number" && data.step > lastStep) {
          last = el;
          lastStep = data.step;
        }
      }
      if (!last) {
        ctx.ui.toast("Insert a flow first");
        return null;
      }
      if (!canBindToCanvas(ctx.host.api.revision)) {
        ctx.ui.toast(
          "Adding a step needs a newer Vaultdraw (plugin API 0.9.0)",
        );
        return null;
      }
      try {
        return await ctx.scene.batch(stepOps(last, lastStep + 1), { path });
      } catch (err) {
        ctx.ui.toast(
          err && err.code === "READ_ONLY"
            ? "This drawing is read-only"
            : "Could not add the step",
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
        " ",
        h("button", { type: "button", onClick: addStep }, "Add a step"),
      );
    }

    ctx.panels.register("flow", Panel);
    ctx.commands.register("insert", insert);
    ctx.commands.register("extend", addStep);
  },
});
