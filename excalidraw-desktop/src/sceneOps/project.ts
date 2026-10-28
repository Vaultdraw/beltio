/**
 * Read side: a frozen, plain-object projection of the live scene. Live
 * elements are mutated in place while dragging, so they are never handed out.
 */
import { FONT_FAMILY } from "@excalidraw/common";
import { getSceneVersion } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import type {
  SceneElement,
  SceneElementDetail,
  SceneElementType,
} from "./types";

const KNOWN: ReadonlySet<string> = new Set([
  "rectangle",
  "ellipse",
  "diamond",
  "text",
  "arrow",
  "line",
  "freedraw",
  "image",
  "frame",
]);

export const toSceneElement = (el: ExcalidrawElement): SceneElement => {
  const out: {
    -readonly [K in keyof SceneElement]: SceneElement[K];
  } = {
    id: el.id,
    type: (KNOWN.has(el.type) ? el.type : "other") as SceneElementType,
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
    angle: el.angle,
  };
  if (el.type === "text") {
    out.text = el.text;
  }
  if (el.type === "frame" && (el as { name?: string | null }).name) {
    out.name = (el as { name: string }).name;
  }
  if (el.strokeColor !== undefined) {
    out.strokeColor = el.strokeColor;
  }
  if (el.backgroundColor !== undefined) {
    out.backgroundColor = el.backgroundColor;
  }
  return out;
};

let cachedFor: readonly ExcalidrawElement[] | null = null;
let cachedVersion = NaN;
let cached: readonly SceneElement[] = Object.freeze([]);

/** Non-deleted elements; O(1) while (array identity, scene version) hold. */
export const projectScene = (
  els: readonly ExcalidrawElement[],
): readonly SceneElement[] => {
  const version = getSceneVersion(els);
  if (els === cachedFor && version === cachedVersion) {
    return cached;
  }
  const out: SceneElement[] = [];
  for (const el of els) {
    if (!el.isDeleted) {
      out.push(toSceneElement(el));
    }
  }
  cachedFor = els;
  cachedVersion = version;
  cached = Object.freeze(out);
  return cached;
};

export const FONT_NAME = new Map<number, string>(
  Object.entries(FONT_FAMILY).map(([name, n]) => [n as number, name]),
);

/** A deep copy of plain JSON (data comes from the drawing file). */
const copyJson = <T>(v: T): T =>
  v === null || typeof v !== "object" ? v : structuredClone(v);

export interface DetailOptions {
  points?: boolean;
  data?: boolean;
}

/** One element with the rich fields (`scene.get`); data only under `dataKey`. */
export const toSceneElementDetail = (
  el: ExcalidrawElement,
  options: DetailOptions,
  dataKey: string | null,
): SceneElementDetail => {
  const out: Record<string, unknown> = {
    ...toSceneElement(el),
    groupIds: [...el.groupIds],
    frameId: el.frameId ?? null,
    containerId: (el as { containerId?: string | null }).containerId ?? null,
    locked: el.locked,
    link: el.link ?? null,
    opacity: el.opacity,
    strokeWidth: el.strokeWidth,
    strokeStyle: el.strokeStyle,
    fillStyle: el.fillStyle,
    roundness: el.roundness ? "round" : "sharp",
  };
  if (el.type === "text") {
    out.fontSize = el.fontSize;
    out.fontFamily = FONT_NAME.get(el.fontFamily) ?? String(el.fontFamily);
  }
  if (el.type === "image") {
    out.fileId = el.fileId ?? null;
  }
  if (options.points && (el.type === "line" || el.type === "arrow")) {
    out.points = el.points.map((p) => [p[0], p[1]] as const);
  }
  if (options.data && dataKey) {
    const value = el.customData?.[dataKey];
    if (value !== undefined) {
      out.data = copyJson(value);
    }
  }
  return out as unknown as SceneElementDetail;
};

/** Details of the listed live elements, in the order asked (one scan, stops early). */
export const sceneDetails = (
  els: readonly ExcalidrawElement[],
  ids: readonly string[],
  options: DetailOptions = {},
  dataKey: string | null = null,
): SceneElementDetail[] => {
  const wanted = new Set(ids);
  const found = new Map<string, ExcalidrawElement>();
  for (const el of els) {
    if (wanted.has(el.id) && !el.isDeleted) {
      found.set(el.id, el);
      if (found.size === wanted.size) {
        break;
      }
    }
  }
  const out: SceneElementDetail[] = [];
  const done = new Set<string>();
  for (const id of ids) {
    const el = found.get(id);
    if (el && !done.has(id)) {
      done.add(id);
      out.push(toSceneElementDetail(el, options, dataKey));
    }
  }
  return out;
};

/** The data under `dataKey` of one live element (a copy), or undefined. */
export const elementData = (
  els: readonly ExcalidrawElement[],
  id: string,
  dataKey: string,
): unknown => {
  for (const el of els) {
    if (el.id === id) {
      const value = el.isDeleted ? undefined : el.customData?.[dataKey];
      return value === undefined ? undefined : copyJson(value);
    }
  }
  return undefined;
};
