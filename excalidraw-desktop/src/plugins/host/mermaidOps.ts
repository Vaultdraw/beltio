/**
 * Mermaid-to-Excalidraw skeleton elements as plugin scene ops (`ctx.diagrams.mermaidToElements`).
 * Pure: the converter itself is loaded by diagramsContext.ts.
 */
import type { MermaidDrawing, NewElement, SceneOp } from "../api";

type Skeleton = Record<string, unknown> & { id?: string; type: string };

const SHAPES = new Set(["rectangle", "ellipse", "diamond"]);
const STROKE_STYLES = new Set(["solid", "dashed", "dotted"]);
const FILL_STYLES = new Set(["hachure", "cross-hatch", "solid", "zigzag"]);

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;
const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;

/** Look and size shared by every element type; only values the ops accept are copied. */
function common(sk: Skeleton): Partial<NewElement> {
  const out: Partial<NewElement> = {};
  const stroke = str(sk.strokeColor);
  const bg = str(sk.backgroundColor);
  const sw = num(sk.strokeWidth);
  const op = num(sk.opacity);
  if (stroke) {
    out.strokeColor = stroke;
  }
  if (bg) {
    out.backgroundColor = bg;
  }
  if (sw !== undefined && sw > 0) {
    out.strokeWidth = sw;
  }
  if (op !== undefined && op >= 0 && op <= 100) {
    out.opacity = op;
  }
  if (typeof sk.strokeStyle === "string" && STROKE_STYLES.has(sk.strokeStyle)) {
    out.strokeStyle = sk.strokeStyle as NewElement["strokeStyle"];
  }
  if (typeof sk.fillStyle === "string" && FILL_STYLES.has(sk.fillStyle)) {
    out.fillStyle = sk.fillStyle as NewElement["fillStyle"];
  }
  return out;
}

/** Ops for a converter result, the top left of the diagram at 0, 0. */
export function skeletonsToOps(skeletons: readonly Skeleton[]): MermaidDrawing {
  const ids = new Set(skeletons.map((s) => s.id).filter(Boolean) as string[]);
  const boxed: SceneOp[] = [];
  const linked: SceneOp[] = [];
  let skipped = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const grow = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  const shift: Array<(dx: number, dy: number) => void> = [];

  for (const sk of skeletons) {
    const x = num(sk.x) ?? 0;
    const y = num(sk.y) ?? 0;
    const label = sk.label as
      | { text?: unknown; fontSize?: unknown }
      | undefined;
    if (sk.type === "text") {
      const el: NewElement = {
        type: "text",
        x,
        y,
        text: str(sk.text) ?? "",
        ...common(sk),
      };
      const fs = num(sk.fontSize);
      if (fs) {
        el.fontSize = fs;
      }
      grow(x, y);
      grow(x + (num(sk.width) ?? 0), y + (num(sk.height) ?? 0));
      shift.push((dx, dy) => {
        el.x = x + dx;
        el.y = y + dy;
      });
      boxed.push({ op: "add", element: el });
    } else if (SHAPES.has(sk.type)) {
      const el: NewElement = {
        type: sk.type as NewElement["type"],
        x,
        y,
        width: num(sk.width) ?? 100,
        height: num(sk.height) ?? 50,
        ...common(sk),
      };
      if (sk.roundness) {
        el.roundness = "round";
      }
      const text = str(label?.text);
      if (text) {
        el.text = text;
        const fs = num(label?.fontSize);
        if (fs) {
          el.fontSize = fs;
        }
      }
      grow(x, y);
      grow(x + (el.width ?? 0), y + (el.height ?? 0));
      shift.push((dx, dy) => {
        el.x = x + dx;
        el.y = y + dy;
      });
      boxed.push({ op: "add", ref: sk.id, element: el });
    } else if (sk.type === "arrow" || sk.type === "line") {
      const pts = Array.isArray(sk.points)
        ? (sk.points as unknown[]).filter(
            (p): p is [number, number] =>
              Array.isArray(p) &&
              typeof p[0] === "number" &&
              typeof p[1] === "number",
          )
        : [];
      const el: NewElement = { type: sk.type, x, y, ...common(sk) };
      if (pts.length >= 2) {
        el.points = pts;
      }
      for (const [px, py] of pts) {
        grow(x + px, y + py);
      }
      const text = str(label?.text);
      if (sk.type === "arrow" && text) {
        el.text = text;
      }
      // A straight arrow between two shapes is bound to them (the app lays it on their outlines);
      // a bent one keeps its points.
      const a = (sk.start as { id?: unknown } | undefined)?.id;
      const b = (sk.end as { id?: unknown } | undefined)?.id;
      if (
        sk.type === "arrow" &&
        pts.length <= 2 &&
        typeof a === "string" &&
        typeof b === "string" &&
        ids.has(a) &&
        ids.has(b)
      ) {
        el.start = { ref: a };
        el.end = { ref: b };
      }
      shift.push((dx, dy) => {
        el.x = x + dx;
        el.y = y + dy;
      });
      linked.push({ op: "add", element: el });
    } else {
      skipped++;
    }
  }
  if (minX === Infinity) {
    return { ops: [], width: 0, height: 0, skipped };
  }
  for (const move of shift) {
    move(-minX, -minY);
  }
  return {
    ops: [...boxed, ...linked],
    width: Math.round(maxX - minX),
    height: Math.round(maxY - minY),
    skipped,
  };
}
