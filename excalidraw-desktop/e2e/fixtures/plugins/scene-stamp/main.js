import { createElement as h } from "react";

const box = {
  op: "add",
  element: { type: "rectangle", width: 100, height: 60 },
};

export default {
  activate(ctx) {
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
