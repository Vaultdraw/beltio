/** Mermaid in the model's answer becomes shapes through the host's own converter. */
import type { PluginContext } from "@vaultdraw/api";

/** The first fenced code block, or the whole answer when it has none. */
export function mermaidFrom(answer: string): string {
  const fence = /```(?:mermaid)?[ \t]*\n([\s\S]*?)```/i.exec(answer);
  return (fence ? fence[1] : answer).trim();
}

/** Draws the diagram at the centre of the view as one undo step. Returns the element count. */
export async function insertDiagram(
  ctx: PluginContext,
  answer: string,
): Promise<number> {
  const text = mermaidFrom(answer);
  if (!text) {
    throw new Error("There is no diagram in the answer.");
  }
  let drawing;
  try {
    drawing = await ctx.diagrams.mermaidToElements(text);
  } catch (err) {
    throw new Error(
      `The model's diagram could not be drawn: ${(err as Error).message}`,
    );
  }
  const c = ctx.scene.viewportCenter();
  const dx = c.x - drawing.width / 2;
  const dy = c.y - drawing.height / 2;
  const ops = drawing.ops.map((op) =>
    op.op === "add" && "x" in op.element
      ? {
          ...op,
          element: {
            ...op.element,
            x: (op.element.x ?? 0) + dx,
            y: (op.element.y ?? 0) + dy,
          },
        }
      : op,
  );
  const r = await ctx.scene.batch(ops);
  return r.ids.length;
}
