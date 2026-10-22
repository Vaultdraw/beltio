/**
 * Read side: a frozen, plain-object projection of the live scene. Live
 * elements are mutated in place while dragging, so they are never handed out.
 */
import { getSceneVersion } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import type { SceneElement, SceneElementType } from "./types";

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
