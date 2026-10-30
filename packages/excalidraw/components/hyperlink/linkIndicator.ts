import { pointFrom, pointRotateRads } from "@excalidraw/math";

import { getFontString } from "@excalidraw/common";
import {
  getBoundTextElement,
  getElementAbsoluteCoords,
  getLineWidth,
} from "@excalidraw/element";

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

/** One underlined line of text (scene coordinates, before rotation). */
export type LinkUnderlineSegment = { x1: number; x2: number; y: number };

/**
 * Underline of an element: one segment under each non-empty line of its text,
 * as wide as that line (Obsidian underlines the link text on every line).
 * `x1`, `x2` and `y` repeat the last segment.
 */
export type LinkUnderline = {
  x1: number;
  x2: number;
  /** y of the line */
  y: number;
  segments: readonly LinkUnderlineSegment[];
  /** Height of one line of the text, in scene units. */
  lineHeight: number;
  centerX: number;
  centerY: number;
  angle: Radians;
};

type TextLike = {
  version: number;
  text: string;
  width: number;
  fontSize: number;
  fontFamily: number;
  lineHeight: number;
  textAlign: string;
};

// Line widths per text element version: measured once, not every frame.
const segmentCache = new WeakMap<
  object,
  {
    version: number;
    width: number;
    rel: readonly LinkUnderlineSegment[];
    lineHeight: number;
  }
>();

/** Segments relative to the text box's top-left corner. */
const relativeSegments = (text: TextLike) => {
  const hit = segmentCache.get(text);
  if (hit && hit.version === text.version && hit.width === text.width) {
    return hit;
  }
  const lines = text.text.split("\n");
  const lineHeight = text.fontSize * text.lineHeight;
  let rel: LinkUnderlineSegment[];
  if (lines.length < 2) {
    rel = [{ x1: 0, x2: text.width, y: lineHeight }];
  } else {
    const font = getFontString(text as never);
    rel = [];
    lines.forEach((line, i) => {
      const w = Math.min(text.width, getLineWidth(line.trimEnd(), font));
      if (w <= 0) {
        return;
      }
      const x1 =
        text.textAlign === "center"
          ? (text.width - w) / 2
          : text.textAlign === "right"
          ? text.width - w
          : 0;
      rel.push({ x1, x2: x1 + w, y: (i + 1) * lineHeight });
    });
    if (!rel.length) {
      rel = [{ x1: 0, x2: text.width, y: lineHeight * lines.length }];
    }
  }
  const entry = { version: text.version, width: text.width, rel, lineHeight };
  segmentCache.set(text, entry);
  return entry;
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
  const { rel, lineHeight } = relativeSegments(text as unknown as TextLike);
  const segments = rel.map((r) => ({
    x1: x1 + r.x1,
    x2: x1 + r.x2,
    y: Math.min(y2, y1 + r.y) - UNDERLINE_INSET,
  }));
  const last = segments[segments.length - 1];
  return {
    x1: last.x1,
    x2: last.x2,
    y: last.y,
    segments,
    lineHeight: Math.min(lineHeight, y2 - y1),
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

/** Whether the scene point is on an underline strip (12 screen px tall, at most a quarter of a line above it). */
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
  // Above each line the strip never reaches past the lower quarter of the
  // line: zoomed out, 6 screen px would cover the whole text and a click to
  // select it would open the link.
  const above = Math.min(half, underline.lineHeight * MAX_TEXT_SHARE_ABOVE);
  return underline.segments.some(
    (s) =>
      px > s.x1 - slack &&
      px < s.x2 + slack &&
      py > s.y - above &&
      py < s.y + half,
  );
};
