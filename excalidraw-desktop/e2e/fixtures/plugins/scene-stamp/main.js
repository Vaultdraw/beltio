import { createElement as h } from "react";

const box = {
  op: "add",
  element: { type: "rectangle", width: 100, height: 60 },
};

/**
 * A connected flow of about `n` elements, 40% text: per unit a labelled box,
 * a plain box, an arrow bound between them and a free text (5 elements,
 * 4 add ops), all in one group.
 */
const flowOps = (n) => {
  const units = Math.max(1, Math.round(n / 5));
  const ops = [];
  const members = [];
  for (let i = 0; i < units; i++) {
    const x = (i % 20) * 260;
    const y = Math.floor(i / 20) * 180;
    ops.push(
      {
        op: "add",
        ref: `a${i}`,
        element: { type: "rectangle", x, y, width: 100, height: 60, text: `Step ${i}` },
      },
      {
        op: "add",
        ref: `b${i}`,
        element: { type: "ellipse", x: x + 150, y, width: 80, height: 60 },
      },
      {
        op: "add",
        ref: `c${i}`,
        element: { type: "arrow", start: { ref: `a${i}` }, end: { ref: `b${i}` } },
      },
      {
        op: "add",
        ref: `t${i}`,
        element: { type: "text", x, y: y + 80, text: `note ${i}` },
      },
    );
    members.push(...["a", "b", "c", "t"].map((k) => ({ ref: `${k}${i}` })));
  }
  ops.push({ op: "group", ids: members });
  return ops;
};

export default {
  activate(ctx) {
    // Perf: one batch of a connected flow, timed to the next painted frame.
    window.__sceneStampFlow = async (n) => {
      const ops = flowOps(n);
      const t0 = performance.now();
      await ctx.scene.batch(ops);
      const applied = performance.now() - t0;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return { applied, painted: performance.now() - t0, ops: ops.length };
    };
    ctx.commands.register("stamp", () => ctx.scene.batch([box]));
    // Perf: latency of one batch of 100 adds, read by the perf spec.
    ctx.commands.register("stamp100", async () => {
      const t0 = performance.now();
      await ctx.scene.batch(Array.from({ length: 100 }, () => box));
      (window.__sceneBatchMs ??= []).push(performance.now() - t0);
    });
    ctx.panels.register("stamp", () => {
      const count = ctx.scene.useScene((els) => els.length);
      return h(
        "div",
        { style: { padding: 12 } },
        h("span", { "data-testid": "scene-count" }, `Elements: ${count}`),
      );
    });
  },
};
