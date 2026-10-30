import { pointFrom, pointRotateRads } from "@excalidraw/math";

import { getElementAbsoluteCoords } from "@excalidraw/element";
import { hitElementBoundingBox } from "@excalidraw/element";

import type { GlobalPoint, Radians } from "@excalidraw/math";

import type { Bounds } from "@excalidraw/common";
import type {
  ElementsMap,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import {
  getLinkIndicatorStyle,
  getLinkUnderline,
  isPointHittingUnderline,
  showsLinkGlyph,
  showsLinkUnderline,
} from "./linkIndicator";

import type { AppState } from "../../types";

export const DEFAULT_LINK_SIZE = 12;

export const getLinkHandleFromCoords = (
  [x1, y1, x2, y2]: Bounds,
  angle: Radians,
  appState: Pick<AppState, "zoom">,
): Bounds => {
  const size = DEFAULT_LINK_SIZE;
  const zoom = appState.zoom.value > 1 ? appState.zoom.value : 1;
  const linkWidth = size / zoom;
  const linkHeight = size / zoom;
  const linkMarginY = size / zoom;
  const centerX = (x1 + x2) / 2;
  const centerY = (y1 + y2) / 2;
  const centeringOffset = (size - 8) / (2 * zoom);
  const dashedLineMargin = 4 / zoom;

  // Same as `ne` resize handle
  const x = x2 + dashedLineMargin - centeringOffset;
  const y = y1 - dashedLineMargin - linkMarginY + centeringOffset;

  const [rotatedX, rotatedY] = pointRotateRads(
    pointFrom(x + linkWidth / 2, y + linkHeight / 2),
    pointFrom(centerX, centerY),
    angle,
  );
  return [
    rotatedX - linkWidth / 2,
    rotatedY - linkHeight / 2,
    linkWidth,
    linkHeight,
  ];
};

export const isPointHittingLinkIcon = (
  element: NonDeletedExcalidrawElement,
  elementsMap: ElementsMap,
  appState: AppState,
  [x, y]: GlobalPoint,
) => {
  const style = getLinkIndicatorStyle();
  const underline = getLinkUnderline(element, elementsMap);
  if (underline && showsLinkUnderline(style, true)) {
    if (
      isPointHittingUnderline(underline, appState.zoom.value, pointFrom(x, y))
    ) {
      return true;
    }
  }
  if (!showsLinkGlyph(style, !!underline)) {
    return false;
  }
  const threshold = 4 / appState.zoom.value;
  const [x1, y1, x2, y2] = getElementAbsoluteCoords(element, elementsMap);
  const [linkX, linkY, linkWidth, linkHeight] = getLinkHandleFromCoords(
    [x1, y1, x2, y2],
    element.angle,
    appState,
  );
  const hitLink =
    x > linkX - threshold &&
    x < linkX + threshold + linkWidth &&
    y > linkY - threshold &&
    y < linkY + linkHeight + threshold;
  return hitLink;
};

export const isPointHittingLink = (
  element: NonDeletedExcalidrawElement,
  elementsMap: ElementsMap,
  appState: AppState,
  [x, y]: GlobalPoint,
  isMobile: boolean,
) => {
  if (!element.link || appState.selectedElementIds[element.id]) {
    return false;
  }
  if (
    !isMobile &&
    appState.viewModeEnabled &&
    hitElementBoundingBox(pointFrom(x, y), element, elementsMap)
  ) {
    return true;
  }
  return isPointHittingLinkIcon(
    element,
    elementsMap,
    appState,
    pointFrom(x, y),
  );
};
