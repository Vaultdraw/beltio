/**
 * frames: a Frames panel (the drawing's frames in slide order, reorder, rename, zoom) and
 * full-screen presentation with each frame as a slide. An official, bundled plugin; nothing of it
 * loads until the panel or a command is used. The order is kept on each frame in the drawing's
 * own data (`customData.frames.order`), so the file still opens in Excalidraw.
 */
import { definePlugin } from "@vaultdraw/api";

import css from "./frames.css";
import FramesPanel from "./FramesPanel";
import { moveId } from "./order";
import { createPresenter } from "./present";
import { saveOrder, slidesOf } from "./store";

import type { PluginContext } from "@vaultdraw/api";

/** Moves the selected frame one place; the toast says why nothing moved. */
async function moveSelected(ctx: PluginContext, by: -1 | 1) {
  const slides = slidesOf(ctx);
  const sel = ctx.scene.selection();
  const from = slides.findIndex((f) => sel.includes(f.id));
  if (from < 0) {
    ctx.ui.toast("Select a frame first");
    return;
  }
  const ids = slides.map((f) => f.id);
  await saveOrder(ctx, moveId(ids, from, from + by));
}

export default definePlugin({
  activate(ctx) {
    const el = document.createElement("style");
    el.textContent = css;
    document.head.appendChild(el);
    ctx.subscriptions.push({ dispose: () => el.remove() });

    const presenter = createPresenter(ctx);
    ctx.subscriptions.push({ dispose: () => presenter.end() });

    ctx.panels.register("list", () => (
      <FramesPanel ctx={ctx} present={() => void presenter.start("current")} />
    ));

    ctx.commands.register("present", () => presenter.start("current"));
    ctx.commands.register("present-first", () => presenter.start("first"));
    ctx.commands.register("next", () => presenter.step(1));
    ctx.commands.register("prev", () => presenter.step(-1));
    ctx.commands.register("first", () => presenter.go(0));
    ctx.commands.register("last", () => presenter.last());
    ctx.commands.register("laser", () => presenter.toggleLaser());
    ctx.commands.register("exit", () => presenter.end());
    ctx.commands.register("move-up", () => moveSelected(ctx, -1));
    ctx.commands.register("move-down", () => moveSelected(ctx, 1));
  },
});
