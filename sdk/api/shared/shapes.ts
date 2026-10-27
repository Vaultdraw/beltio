/**
 * The pure part of `ctx.shapes`, shared by the app host and the mock host: turn a shape's
 * `render` output into scene ops. Both hosts run the same code, so a plugin test and the app agree.
 */
import { PluginApiError } from "./rules";

import type {
  Disposable,
  Json,
  ShapesApi,
  NewElement,
  SceneContextApi,
  SceneOp,
  ShapeDef,
} from "../src/index";

/** Most SVG text a shape may render, in bytes. */
export const SHAPE_MAX_SVG_BYTES = 200 * 1024;

export interface ShapeDecl {
  id: string;
  title: string;
  width: number;
  height: number;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const invalid = (message: string) =>
  new PluginApiError("INVALID_ARGUMENT", message);

const finite = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n);

/** The picture of a shape: the SVG bytes, or a PluginApiError that names the problem. */
export function renderShape(
  shapeId: string,
  def: ShapeDef,
  props: Json,
  size: { width: number; height: number },
): Uint8Array {
  const svg = def.render(props, size);
  if (
    typeof svg !== "string" ||
    !/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(svg)
  ) {
    throw invalid(
      `shape "${shapeId}" must render a string that starts with <svg`,
    );
  }
  const bytes = new TextEncoder().encode(svg);
  if (bytes.byteLength > SHAPE_MAX_SVG_BYTES) {
    throw invalid(
      `shape "${shapeId}" rendered ${bytes.byteLength} bytes; the most is ${SHAPE_MAX_SVG_BYTES}`,
    );
  }
  return bytes;
}

/** The image element of a shape: its picture, and its name and props as the plugin's data. */
export function shapeElement(
  shapeId: string,
  props: Json,
  bytes: Uint8Array,
  rect: Rect,
): NewElement {
  return {
    type: "image",
    ...rect,
    image: { mime: "image/svg+xml", bytes },
    data: { shape: shapeId, props },
  };
}

/** Where and how large a new shape is. */
export function shapeRect(
  decl: ShapeDecl,
  center: { x: number; y: number },
  at?: Partial<Rect>,
): Rect {
  for (const [k, v] of Object.entries(at ?? {})) {
    if (!finite(v)) {
      throw invalid(`shape position "${k}" must be a finite number`);
    }
  }
  const width = at?.width ?? decl.width;
  const height = at?.height ?? decl.height;
  if (width <= 0 || height <= 0) {
    throw invalid("shape width and height must be above 0");
  }
  return {
    x: at?.x ?? center.x - width / 2,
    y: at?.y ?? center.y - height / 2,
    width,
    height,
  };
}

/** Ops that replace a shape element with a freshly drawn one in the same place. */
export function updateOps(
  scene: Pick<SceneContextApi, "get" | "dataOf">,
  elementId: string,
  props: Json,
  defs: (shapeId: string) => { def: ShapeDef } | undefined,
): SceneOp[] {
  const [el] = scene.get([elementId]);
  const data = scene.dataOf(elementId);
  const shapeId =
    el &&
    el.type === "image" &&
    data &&
    typeof data === "object" &&
    !Array.isArray(data)
      ? (data as Record<string, Json>).shape
      : undefined;
  const found = typeof shapeId === "string" ? defs(shapeId) : undefined;
  if (!el || typeof shapeId !== "string" || !found) {
    throw invalid(`element "${elementId}" is not a shape of this plugin`);
  }
  const rect = { x: el.x, y: el.y, width: el.width, height: el.height };
  const bytes = renderShape(shapeId, found.def, props, rect);
  return [
    { op: "delete", id: elementId },
    { op: "add", element: shapeElement(shapeId, props, bytes, rect) },
  ];
}

/**
 * `ctx.shapes` for either host. `onRegister` lets the app hook the insert command of a registered
 * shape up to the palette and the toolbar; its result is called when the shape is unregistered.
 */
export function createShapesApi(
  decls: readonly ShapeDecl[],
  scene: Pick<SceneContextApi, "batch" | "viewportCenter" | "get" | "dataOf">,
  track: (fn: () => void) => Disposable,
  refuse: (what: string, short: string) => Disposable,
  onRegister?: (shapeId: string, insert: () => Promise<unknown>) => () => void,
): ShapesApi {
  const declared = new Map(decls.map((d) => [d.id, d] as const));
  const defs = new Map<string, ShapeDef>();

  const insert: ShapesApi["insert"] = async (shapeId, props, at) => {
    const decl = declared.get(shapeId);
    const def = defs.get(shapeId);
    if (!decl || !def) {
      throw invalid(
        `shape "${shapeId}" is not declared in plugin.toml or has no register() call`,
      );
    }
    const rect = shapeRect(decl, scene.viewportCenter(), at);
    const start = (props ?? def.defaults ?? {}) as Json;
    const bytes = renderShape(shapeId, def, start, rect);
    const result = await scene.batch([
      { op: "add", element: shapeElement(shapeId, start, bytes, rect) },
    ]);
    return result.ids[0];
  };

  return {
    register(shapeId, def) {
      if (!declared.has(shapeId)) {
        return refuse("shape", shapeId);
      }
      defs.set(shapeId, def);
      const off = onRegister?.(shapeId, () => insert(shapeId));
      return track(() => {
        off?.();
        if (defs.get(shapeId) === def) {
          defs.delete(shapeId);
        }
      });
    },
    insert,
    async update(elementId, props) {
      const ops = updateOps(scene, elementId, props, (s) => {
        const def = defs.get(s);
        return def ? { def } : undefined;
      });
      const result = await scene.batch(ops);
      return result.ids[0];
    },
  };
}
