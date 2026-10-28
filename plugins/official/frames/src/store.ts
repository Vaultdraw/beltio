/** Reads the drawing's frames in slide order and writes a new order back (one undo step). */
import { orderFrames, type FrameBox } from "./order";

import type { PluginContext, SceneElement } from "@vaultdraw/api";

export const framesOf = (els: readonly SceneElement[]): FrameBox[] =>
  els
    .filter((e) => e.type === "frame")
    .map((e) => ({
      id: e.id,
      name: e.name,
      x: e.x,
      y: e.y,
      width: e.width,
      height: e.height,
    }));

/** The saved `order` number of a frame (`customData.frames.order`), if any. */
export const orderOf =
  (ctx: PluginContext) =>
  (id: string): number | undefined => {
    const data = ctx.scene.dataOf(id) as { order?: unknown } | undefined;
    return typeof data?.order === "number" ? data.order : undefined;
  };

/** The frames of the open drawing in slide order. */
export const slidesOf = (ctx: PluginContext): FrameBox[] =>
  orderFrames(framesOf(ctx.scene.elements()), orderOf(ctx));

/** Writes `order` = position for every frame whose number changes, as one batch. */
export async function saveOrder(
  ctx: PluginContext,
  ids: readonly string[],
): Promise<void> {
  const of = orderOf(ctx);
  const ops = ids.flatMap((id, i) =>
    of(id) === i
      ? []
      : [{ op: "update" as const, id, props: { data: { order: i } } }],
  );
  if (ops.length > 0) {
    await ctx.scene.batch(ops);
  }
}

export async function rename(
  ctx: PluginContext,
  id: string,
  name: string,
): Promise<void> {
  await ctx.scene.batch([{ op: "update", id, props: { name: name.trim() } }]);
}
