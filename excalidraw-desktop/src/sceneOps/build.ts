/** Turns validated NewElements into real elements with fresh ids. */
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { getCommonBounds } from "@excalidraw/element";

import type { ExcalidrawElementSkeleton } from "@excalidraw/element/transform";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import type { NewElement } from "./types";

const CONTAINERS = new Set(["rectangle", "ellipse", "diamond", "arrow"]);

const toSkeleton = (e: NewElement): ExcalidrawElementSkeleton => {
  const { text, points, ...rest } = e;
  const sk: Record<string, unknown> = { ...rest, x: e.x ?? 0, y: e.y ?? 0 };
  if (e.type === "text") {
    sk.text = text ?? "";
  } else if (text) {
    sk.label = { text }; // container label, not a free text
  }
  if (points) {
    sk.points = points;
  }
  if (e.type === "line" || e.type === "arrow") {
    // A linear element's box follows its points; an explicit size would fight it.
    if (points) {
      delete sk.width;
      delete sk.height;
    }
  } else if (!CONTAINERS.has(e.type) && e.type !== "text") {
    delete sk.points;
  }
  return sk as unknown as ExcalidrawElementSkeleton;
};

/**
 * Elements missing x and/or y are shifted as a group so their bounding box is
 * centred at `center` (relative offsets kept). A given x or y stays absolute.
 */
export const buildElements = (
  adds: readonly NewElement[],
  center: { x: number; y: number },
): ExcalidrawElement[] => {
  if (!adds.length) {
    return [];
  }
  const built = convertToExcalidrawElements(
    adds.map(toSkeleton),
  ) as ExcalidrawElement[];
  // Labels add bound text elements after the skeleton's own; map by order of the primaries.
  const unplacedX = new Set<number>();
  const unplacedY = new Set<number>();
  let cursor = 0;
  const owner: number[] = [];
  for (const el of built) {
    if (
      el.type === "text" &&
      (el as { containerId?: string | null }).containerId
    ) {
      owner.push(cursor - 1);
    } else {
      owner.push(cursor++);
    }
  }
  adds.forEach((a, i) => {
    if (a.x === undefined) {
      unplacedX.add(i);
    }
    if (a.y === undefined) {
      unplacedY.add(i);
    }
  });
  const inGroup = (k: number) =>
    unplacedX.has(owner[k]) || unplacedY.has(owner[k]);
  const group = built.filter((_, k) => inGroup(k));
  if (!group.length) {
    return built;
  }
  const [x1, y1, x2, y2] = getCommonBounds(group);
  const dx = center.x - (x1 + x2) / 2;
  const dy = center.y - (y1 + y2) / 2;
  // Each axis is placed on its own: a given x or y is never overwritten.
  return built.map((el, k) => {
    const shiftX = unplacedX.has(owner[k]);
    const shiftY = unplacedY.has(owner[k]);
    return shiftX || shiftY
      ? { ...el, x: shiftX ? el.x + dx : el.x, y: shiftY ? el.y + dy : el.y }
      : el;
  });
};
