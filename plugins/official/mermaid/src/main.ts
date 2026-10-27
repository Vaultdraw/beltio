/**
 * mermaid: Mermaid text to drawings, for other programs (`vaultdraw plugin call`, AI apps). The
 * conversion is the editor's own converter through ctx.diagrams; the dialog and paste stay in
 * the editor.
 */
import { definePlugin } from "@vaultdraw/api";

import type { Json, PluginContext } from "@vaultdraw/api";

export async function toDrawing(
  ctx: PluginContext,
  params: Json,
): Promise<Json> {
  const { text, path } = (params ?? {}) as { text?: unknown; path?: unknown };
  if (typeof text !== "string" || text.trim() === "") {
    throw new Error("text is required: the Mermaid diagram");
  }
  if (path !== undefined && typeof path !== "string") {
    throw new Error("path must be a string ending in .excalidraw");
  }
  const target = path ?? ctx.scene.path();
  if (target === null) {
    throw new Error("give a path for a new drawing, or open a drawing first");
  }
  const diagram = await ctx.diagrams.mermaidToElements(text);
  if (diagram.ops.length === 0) {
    throw new Error("the diagram has nothing to draw");
  }
  if (path !== undefined) {
    const made = await ctx.vault.createDrawing(path, diagram.ops);
    return { path: made.path, elements: made.ids.length };
  }
  // On the drawing on screen: the diagram's top left goes so that it is centred in view.
  const c = ctx.scene.viewportCenter();
  const dx = Math.round(c.x - diagram.width / 2);
  const dy = Math.round(c.y - diagram.height / 2);
  const ops = diagram.ops.map((o) =>
    o.op === "add"
      ? {
          ...o,
          element: {
            ...o.element,
            x: (o.element.x ?? 0) + dx,
            y: (o.element.y ?? 0) + dy,
          },
        }
      : o,
  );
  const done = await ctx.scene.batch(ops, { path: target });
  return { path: target, elements: done.ids.length };
}

export default definePlugin({
  activate(ctx) {
    ctx.methods.register("to_drawing", (params) => toDrawing(ctx, params));
  },
});
