import { pointFrom, pointRotateRads } from "@excalidraw/math";

import { getBoundTextElement } from "@excalidraw/element";
import { getElementAbsoluteCoords } from "@excalidraw/element";

import type { GlobalPoint, Radians } from "@excalidraw/math";
import type {
  ElementsMap,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

/**
 * How an element that carries a link is marked on the canvas.
 * - "underline": a line under the text of text elements and labelled shapes;
 *   elements without text keep the corner glyph.
 * - "icon": the corner glyph only.
 * - "both": underline and corner glyph.
 */
export type LinkIndicatorStyle = "underline" | "icon" | "both";

export type LinkIndicatorConfig = {
  style: LinkIndicatorStyle;
  /** CSS colour of the line and glyph (the host resolves theme and dark mode). */
  color: string;
};

export const DEFAULT_LINK_INDICATOR: LinkIndicatorConfig = {
  style: "icon",
  color: "#1971c2",
};

let current: LinkIndicatorConfig = DEFAULT_LINK_INDICATOR;

/** Read by hit testing (the renderer gets the same value through renderConfig). */
export const setLinkIndicator = (
  config: Partial<LinkIndicatorConfig> | null,
) => {
  current = { ...DEFAULT_LINK_INDICATOR, ...config };
};

export const getLinkIndicatorStyle = (): LinkIndicatorStyle => current.style;

export const isWebLink = (link: string) => /^(https?:|mailto:)/i.test(link);

/** Underline of an element: the text rectangle (scene coordinates) it sits under. */
export type LinkUnderline = {
  x1: number;
  x2: number;
  /** y of the line */
  y: number;
  centerX: number;
  centerY: number;
  angle: Radians;
};

const UNDERLINE_INSET = 1;

/** The underline of a linked element, or null when it has no text to underline. */
export const getLinkUnderline = (
  element: NonDeletedExcalidrawElement,
  elementsMap: ElementsMap,
): LinkUnderline | null => {
  let text: NonDeletedExcalidrawElement | null = null;
  if (element.type === "text") {
    text = element;
  } else if (element.boundElements?.some((b) => b.type === "text")) {
    text = getBoundTextElement(element, elementsMap);
  }
  if (!text || text.width <= 0 || text.height <= 0) {
    return null;
  }
  const [x1, y1, x2, y2] = getElementAbsoluteCoords(text, elementsMap);
  return {
    x1,
    x2,
    y: y2 - UNDERLINE_INSET,
    centerX: (x1 + x2) / 2,
    centerY: (y1 + y2) / 2,
    angle: text.angle,
  };
};

/** Whether the corner glyph is drawn (and hit) for this element. */
export const showsLinkGlyph = (
  style: LinkIndicatorStyle,
  hasUnderline: boolean,
) => style !== "underline" || !hasUnderline;

/** Whether the underline is drawn (and hit) for this element. */
export const showsLinkUnderline = (
  style: LinkIndicatorStyle,
  hasUnderline: boolean,
) => style !== "icon" && hasUnderline;

const HIT_HALF_HEIGHT = 6;
const MAX_TEXT_SHARE_ABOVE = 0.25;

/** Whether the scene point is on the underline strip (12 screen px tall, at most a quarter of the text above the line). */
export const isPointHittingUnderline = (
  underline: LinkUnderline,
  zoom: number,
  [x, y]: GlobalPoint,
) => {
  const [px, py] = pointRotateRads(
    pointFrom(x, y),
    pointFrom(underline.centerX, underline.centerY),
    -underline.angle as Radians,
  );
  const half = HIT_HALF_HEIGHT / zoom;
  const slack = 4 / zoom;
  // Above the line the strip never reaches past the lower quarter of the
  // text: zoomed out, 6 screen px would cover the whole text and a click to
  // select it would open the link.
  const textHeight = 2 * (underline.y + UNDERLINE_INSET - underline.centerY);
  const above = Math.min(half, textHeight * MAX_TEXT_SHARE_ABOVE);
  return (
    px > underline.x1 - slack &&
    px < underline.x2 + slack &&
    py > underline.y - above &&
    py < underline.y + half
  );
};
