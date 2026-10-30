import {
  applyDarkModeFilter,
  FRAME_STYLE,
  THEME,
  throttleRAF,
} from "@excalidraw/common";
import {
  beginElementCanvasFrame,
  didDeferZoomRefresh,
  refreshElementCanvasForZoom,
  ZOOM_REFRESH_FRAME_BUDGET_MS,
} from "@excalidraw/element";
import { createPlaceholderEmbeddableLabel } from "@excalidraw/element";
import { getBoundTextElement } from "@excalidraw/element";
import {
  isEmbeddableElement,
  isIframeLikeElement,
  isTextElement,
} from "@excalidraw/element";
import {
  elementOverlapsWithFrame,
  getTargetFrame,
  shouldApplyFrameClip,
} from "@excalidraw/element";

import {
  getRenderElementWithPositionOverride,
  resolveElementRenderState,
  renderElement,
} from "@excalidraw/element";

import { getElementAbsoluteCoords } from "@excalidraw/element";

import type { ElementRenderState } from "@excalidraw/element";

import type {
  ElementsMap,
  ExcalidrawElement,
  ExcalidrawFrameLikeElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { getLinkHandleFromCoords } from "../components/hyperlink/helpers";
import {
  DEFAULT_LINK_INDICATOR,
  getLinkUnderline,
  isWebLink,
  showsLinkGlyph,
  showsLinkUnderline,
} from "../components/hyperlink/linkIndicator";

import { isPageModeOn } from "../data/pageSetup";

import { renderBackgroundPattern } from "./backgroundPattern";
import { renderPageSurround } from "./pageFrame";

import {
  bootstrapCanvas,
  getNormalizedCanvasDimensions,
  snapScrollToDevicePixels,
} from "./helpers";

import type { LinkIndicatorConfig } from "../components/hyperlink/linkIndicator";

import type {
  StaticCanvasRenderConfig,
  StaticSceneRenderConfig,
} from "../scene/types";
import type { StaticCanvasAppState, Zoom } from "../types";

const GridLineColor = {
  [THEME.LIGHT]: {
    bold: "#dddddd",
    regular: "#e5e5e5",
  },
  [THEME.DARK]: {
    bold: applyDarkModeFilter("#dddddd"),
    regular: applyDarkModeFilter("#e5e5e5"),
  },
} as const;

/**
 * Vaultdraw: `lineDashOffset` that anchors a dashed grid line's pattern to
 * scene coordinate 0 rather than to wherever the line happens to start (which
 * depends on the scroll). `sceneStart` is the scene coordinate the line starts
 * at.
 */
const dashPhase = (dash: number[], sceneStart: number) => {
  const period = dash[0] + dash[1];
  return ((sceneStart % period) + period) % period;
};

/** Vaultdraw: a line exactly on a half device pixel snaps the same way every
 * time (float noise would otherwise tip it either way) */
const SNAP_TIE_BIAS = 1e-6;

export const strokeGrid = (
  context: CanvasRenderingContext2D,
  /** grid cell pixel size */
  gridSize: number,
  /** setting to 1 will disble bold lines */
  gridStep: number,
  scrollX: number,
  scrollY: number,
  zoom: Zoom,
  theme: StaticCanvasRenderConfig["theme"],
  width: number,
  height: number,
  scale: number,
) => {
  const offsetX = (scrollX % gridSize) - gridSize;
  const offsetY = (scrollY % gridSize) - gridSize;

  const actualGridSize = gridSize * zoom.value;

  const spaceWidth = 1 / zoom.value;

  // scene units → device pixels
  const devicePixels = zoom.value * scale;

  // A line at least a device pixel wide is drawn a whole number of device
  // pixels wide and centered to cover them exactly — on the half pixel when
  // the count is odd. Straddling a pixel boundary renders it as two lighter
  // pixels, which is how the grid looked at every zoom but 100%. Thinner
  // lines (zoomed far out) keep their sub-pixel width: their lightness is
  // the point.
  const snap = (position: number, maxWidthInCssPixels: number) => {
    // a line is `min(1 / zoom, max)` scene units wide; computed straight in
    // device pixels, so `(1 / zoom) × zoom` never lands just under 1
    const widthInDevicePixels = Math.min(
      scale,
      maxWidthInCssPixels * devicePixels,
    );
    if (widthInDevicePixels < 1) {
      return { position, lineWidth: widthInDevicePixels / devicePixels };
    }
    const wholeWidth = Math.round(widthInDevicePixels);
    const center = wholeWidth % 2 ? 0.5 : 0;
    return {
      position:
        (Math.round(position * devicePixels - center + SNAP_TIE_BIAS) +
          center) /
        devicePixels,
      lineWidth: wholeWidth / devicePixels,
    };
  };

  context.save();

  // vertical lines
  for (let x = offsetX; x < offsetX + width + gridSize * 2; x += gridSize) {
    const isBold =
      gridStep > 1 && Math.round(x - scrollX) % (gridStep * gridSize) === 0;
    // don't render regular lines when zoomed out and they're barely visible
    if (!isBold && actualGridSize < 10) {
      continue;
    }

    const { position, lineWidth } = snap(x, isBold ? 4 : 1);
    context.lineWidth = lineWidth;
    const lineDash = [lineWidth * 3, spaceWidth + (lineWidth + spaceWidth)];

    context.beginPath();
    context.setLineDash(isBold ? [] : lineDash);
    context.lineDashOffset = dashPhase(lineDash, offsetY - gridSize - scrollY);
    context.strokeStyle = isBold
      ? GridLineColor[theme].bold
      : GridLineColor[theme].regular;
    context.moveTo(position, offsetY - gridSize);
    context.lineTo(position, Math.ceil(offsetY + height + gridSize * 2));
    context.stroke();
  }

  for (let y = offsetY; y < offsetY + height + gridSize * 2; y += gridSize) {
    const isBold =
      gridStep > 1 && Math.round(y - scrollY) % (gridStep * gridSize) === 0;
    if (!isBold && actualGridSize < 10) {
      continue;
    }

    const { position, lineWidth } = snap(y, isBold ? 4 : 1);
    context.lineWidth = lineWidth;
    const lineDash = [lineWidth * 3, spaceWidth + (lineWidth + spaceWidth)];

    context.beginPath();
    context.setLineDash(isBold ? [] : lineDash);
    context.lineDashOffset = dashPhase(lineDash, offsetX - gridSize - scrollX);
    context.strokeStyle = isBold
      ? GridLineColor[theme].bold
      : GridLineColor[theme].regular;
    context.moveTo(offsetX - gridSize, position);
    context.lineTo(Math.ceil(offsetX + width + gridSize * 2), position);
    context.stroke();
  }
  context.restore();
};

export const frameClip = (
  frame: ExcalidrawFrameLikeElement,
  context: CanvasRenderingContext2D,
  renderConfig: StaticCanvasRenderConfig,
  appState: StaticCanvasAppState,
) => {
  context.translate(frame.x + appState.scrollX, frame.y + appState.scrollY);
  context.beginPath();
  if (context.roundRect) {
    context.roundRect(
      0,
      0,
      frame.width,
      frame.height,
      FRAME_STYLE.radius / appState.zoom.value,
    );
  } else {
    context.rect(0, 0, frame.width, frame.height);
  }
  context.clip();
  context.translate(
    -(frame.x + appState.scrollX),
    -(frame.y + appState.scrollY),
  );
};

// 24x24 glyphs drawn as strokes in the link colour (no box, no fill).
const WEB_LINK_GLYPH = new Path2D(
  "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3",
);
const INTERNAL_LINK_GLYPH = new Path2D("M4 12h15M13 6l6 6-6 6");

const renderLinkIcon = (
  element: NonDeletedExcalidrawElement,
  context: CanvasRenderingContext2D,
  appState: StaticCanvasAppState,
  elementsMap: ElementsMap,
  renderState: ElementRenderState,
  indicator: LinkIndicatorConfig,
) => {
  if (!element.link) {
    return;
  }
  const web = isWebLink(element.link);
  const underline = getLinkUnderline(element, elementsMap);
  const zoom = appState.zoom.value;
  context.save();
  context.globalAlpha = renderState.opacity;
  context.strokeStyle = indicator.color;
  context.lineCap = "round";
  context.lineJoin = "round";

  if (underline && showsLinkUnderline(indicator.style, true)) {
    context.save();
    context.translate(
      appState.scrollX + underline.centerX + renderState.offset.x,
      appState.scrollY + underline.centerY + renderState.offset.y,
    );
    context.rotate(underline.angle);
    context.lineWidth = 1.5 / zoom;
    // Web links are dashed, internal links solid.
    context.setLineDash(web ? [4 / zoom, 3 / zoom] : []);
    context.beginPath();
    for (const segment of underline.segments) {
      const y = segment.y - underline.centerY;
      context.moveTo(segment.x1 - underline.centerX, y);
      context.lineTo(segment.x2 - underline.centerX, y);
    }
    context.stroke();
    context.restore();
  }

  if (
    showsLinkGlyph(indicator.style, !!underline) &&
    !appState.selectedElementIds[element.id]
  ) {
    const [x1, y1, x2, y2] = getElementAbsoluteCoords(element, elementsMap);
    const [x, y, width, height] = getLinkHandleFromCoords(
      [
        x1 + renderState.offset.x,
        y1 + renderState.offset.y,
        x2 + renderState.offset.x,
        y2 + renderState.offset.y,
      ],
      element.angle,
      appState,
    );
    context.translate(
      appState.scrollX + x + width / 2,
      appState.scrollY + y + height / 2,
    );
    context.rotate(element.angle);
    // Glyph box is 24 units; a stroke of 2.25 units is about 1.1 px at 12 px.
    const scale = width / 24;
    context.scale(scale, scale);
    context.translate(-12, -12);
    context.lineWidth = 2.25;
    context.globalAlpha = renderState.opacity * 0.9;
    context.stroke(web ? WEB_LINK_GLYPH : INTERNAL_LINK_GLYPH);
  }
  context.restore();
};

/** View of the pattern and the page surround (screen pixels). */
const patternView = (
  appState: StaticCanvasAppState,
  scale: number,
  canvas: HTMLCanvasElement,
  renderConfig: StaticCanvasRenderConfig,
) => ({
  scrollX: appState.scrollX,
  scrollY: appState.scrollY,
  zoom: appState.zoom.value,
  scale,
  width: canvas.width,
  height: canvas.height,
  isDarkMode: renderConfig.theme === THEME.DARK,
});

/**
 * One pass over the scene. With `sliced` it yields after every painted
 * element, so a caller can hand control back between elements
 * (renderStaticSceneInSlices); without it never yields.
 */
function* paintStaticScene(
  {
    canvas,
    rc,
    elementsMap,
    allElementsMap,
    visibleElements,
    scale,
    appState: unsnappedAppState,
    renderConfig,
  }: StaticSceneRenderConfig,
  sliced: boolean,
): Generator<void, void, void> {
  if (canvas === null) {
    return;
  }

  const { renderGrid = true, isExporting } = renderConfig;
  const linkIndicator: LinkIndicatorConfig = {
    style: renderConfig.linkIndicatorStyle ?? DEFAULT_LINK_INDICATOR.style,
    color: renderConfig.linkIndicatorColor ?? DEFAULT_LINK_INDICATOR.color,
  };
  if (!isExporting) {
    // Vaultdraw: new frame for the element bitmap LRU
    beginElementCanvasFrame(
      visibleElements.length,
      sliced ? Infinity : ZOOM_REFRESH_FRAME_BUDGET_MS,
    );
  }
  // export draws vectors, not cached bitmaps — nothing to keep on the grid
  const appState = isExporting
    ? unsnappedAppState
    : snapScrollToDevicePixels(unsnappedAppState, scale);

  const [normalizedWidth, normalizedHeight] = getNormalizedCanvasDimensions(
    canvas,
    scale,
  );

  const pageMode = !isExporting && isPageModeOn(appState.pageSetup);
  const context = bootstrapCanvas({
    canvas,
    scale,
    normalizedWidth,
    normalizedHeight,
    theme: appState.theme,
    isExporting,
    viewBackgroundColor: appState.viewBackgroundColor,
  });

  // Notebook paper: the snap grid replaces it; exports need the background
  if (
    appState.viewBackgroundPattern &&
    !renderGrid &&
    (!isExporting ||
      (appState.exportBackgroundPattern !== false &&
        appState.viewBackgroundColor !== null))
  ) {
    renderBackgroundPattern(
      context,
      appState.viewBackgroundPattern,
      patternView(appState, scale, canvas, renderConfig),
    );
  }

  // Apply zoom
  context.scale(appState.zoom.value, appState.zoom.value);

  // Grid
  if (renderGrid) {
    strokeGrid(
      context,
      appState.gridSize,
      appState.gridStep,
      appState.scrollX,
      appState.scrollY,
      appState.zoom,
      renderConfig.theme,
      normalizedWidth / appState.zoom.value,
      normalizedHeight / appState.zoom.value,
      scale,
    );
  }

  // Page mode (on screen): paint only the surround outside the pages
  if (pageMode) {
    renderPageSurround(
      context,
      appState.pageSetup,
      patternView(appState, scale, canvas, renderConfig),
    );
  }

  const groupsToBeAddedToFrame = new Set<string>();

  visibleElements.forEach((element) => {
    if (
      element.groupIds.length > 0 &&
      appState.frameToHighlight &&
      appState.selectedElementIds[element.id] &&
      (elementOverlapsWithFrame(
        element,
        appState.frameToHighlight,
        elementsMap,
      ) ||
        element.groupIds.find((groupId) => groupsToBeAddedToFrame.has(groupId)))
    ) {
      element.groupIds.forEach((groupId) =>
        groupsToBeAddedToFrame.add(groupId),
      );
    }
  });

  const inFrameGroupsMap = new Map<string, boolean>();

  const getRenderState = (element: ExcalidrawElement) =>
    resolveElementRenderState(
      element,
      elementsMap,
      renderConfig,
      allElementsMap,
    );

  const clipElementToFrame = (
    element: NonDeletedExcalidrawElement,
    renderState: ElementRenderState,
  ) => {
    if (
      !(element.frameId || appState.frameToHighlight?.id) ||
      !appState.frameRendering.enabled ||
      !appState.frameRendering.clip
    ) {
      return;
    }
    const targetFrame = getTargetFrame(element, elementsMap, appState);
    if (!targetFrame) {
      return;
    }
    const frameState = getRenderState(targetFrame);
    const frame = getRenderElementWithPositionOverride(
      targetFrame,
      frameState.offset,
    );
    const isTranslated = (state: ElementRenderState) =>
      state.offset.x !== 0 || state.offset.y !== 0;
    if (
      (element.frameId === frame.id &&
        (isTranslated(renderState) || isTranslated(frameState))) ||
      shouldApplyFrameClip(
        getRenderElementWithPositionOverride(element, renderState.offset),
        frame,
        appState,
        elementsMap,
        inFrameGroupsMap,
      )
    ) {
      frameClip(frame, context, renderConfig, appState);
    }
  };

  // Paint visible elements
  for (const element of visibleElements) {
    if (isIframeLikeElement(element)) {
      continue;
    }
    try {
      if (
        isTextElement(element) &&
        element.containerId &&
        elementsMap.has(element.containerId)
      ) {
        // will be rendered with the container
        continue;
      }

      context.save();
      const boundTextElement = getBoundTextElement(element, elementsMap);

      const renderState = getRenderState(element);
      clipElementToFrame(element, renderState);
      renderElement(
        element,
        elementsMap,
        allElementsMap,
        rc,
        context,
        renderConfig,
        appState,
        renderState,
      );

      if (boundTextElement) {
        renderElement(
          boundTextElement,
          elementsMap,
          allElementsMap,
          rc,
          context,
          renderConfig,
          appState,
        );
      }

      context.restore();

      if (!isExporting && renderConfig.renderLinks !== false) {
        renderLinkIcon(
          element,
          context,
          appState,
          elementsMap,
          renderState,
          linkIndicator,
        );
      }
    } catch (error: any) {
      console.error(
        error,
        element.id,
        element.x,
        element.y,
        element.width,
        element.height,
      );
    }
    if (sliced) {
      yield;
    }
  }

  // render embeddables on top
  visibleElements
    .filter((el) => isIframeLikeElement(el))
    .forEach((element) => {
      try {
        const renderState = getRenderState(element);
        context.save();
        clipElementToFrame(element, renderState);
        renderElement(
          element,
          elementsMap,
          allElementsMap,
          rc,
          context,
          renderConfig,
          appState,
          renderState,
        );

        if (
          isIframeLikeElement(element) &&
          (isExporting ||
            (isEmbeddableElement(element) &&
              renderConfig.embedsValidationStatus.get(element.id) !== true)) &&
          element.width &&
          element.height
        ) {
          const label = {
            ...createPlaceholderEmbeddableLabel(element),
            // Synthetic visual: resolve overrides and frame opacity through
            // its owner, without creating another animation target.
            id: element.id,
            frameId: element.frameId,
          };
          renderElement(
            label,
            elementsMap,
            allElementsMap,
            rc,
            context,
            renderConfig,
            appState,
          );
        }
        if (!isExporting && renderConfig.renderLinks !== false) {
          renderLinkIcon(
            element,
            context,
            appState,
            elementsMap,
            renderState,
            linkIndicator,
          );
        }
        context.restore();
      } catch (error: any) {
        console.error(error);
      }
    });

  // render pending nodes for flowcharts
  renderConfig.pendingFlowchartNodes?.forEach((element) => {
    try {
      renderElement(
        element,
        elementsMap,
        allElementsMap,
        rc,
        context,
        renderConfig,
        appState,
      );
    } catch (error) {
      console.error(error);
    }
  });
}

/** the config of the last live static render */
let lastRendered: StaticSceneRenderConfig | null = null;
let refreshScheduled = false;
/** longest stretch of deferred re-rasterising before yielding, ms */
const ZOOM_REFRESH_SLICE_MS = 8;

/**
 * Vaultdraw: a render that drew bitmaps at a stale zoom (progressive
 * crisp-up after a zoom, see `beginElementCanvasFrame`) re-rasterises them in
 * slices of ZOOM_REFRESH_SLICE_MS between tasks, without redrawing (the
 * canvas keeps showing the scaled ones), then redraws the scene once. A newer
 * render (any state change) takes over instead.
 */
const scheduleZoomRefresh = (config: StaticSceneRenderConfig) => {
  if (refreshScheduled) {
    return;
  }
  refreshScheduled = true;
  let next = 0;
  const step = () => {
    if (lastRendered !== config || !config.canvas?.isConnected) {
      refreshScheduled = false;
      return;
    }
    const { visibleElements, allElementsMap, renderConfig, appState } = config;
    const sliceEnd = performance.now() + ZOOM_REFRESH_SLICE_MS;
    while (next < visibleElements.length && performance.now() < sliceEnd) {
      refreshElementCanvasForZoom(
        visibleElements[next++],
        allElementsMap,
        renderConfig,
        appState,
      );
    }
    if (next < visibleElements.length) {
      setTimeout(step, 0);
      return;
    }
    refreshScheduled = false;
    requestAnimationFrame(() => {
      if (lastRendered === config && config.canvas?.isConnected) {
        _renderStaticScene(config);
      }
    });
  };
  setTimeout(step, 0);
};

const _renderStaticScene = (config: StaticSceneRenderConfig) => {
  lastRendered = config;
  const steps = paintStaticScene(config, false);
  while (!steps.next().done) {
    // not sliced: never yields, so this is one next() call
  }
  if (!config.renderConfig.isExporting && didDeferZoomRefresh()) {
    scheduleZoomRefresh(config);
  }
};

export type SceneSlicing = {
  /** Longest stretch of painting before control is handed back. */
  budgetMs: number;
  /** Hands control back to the event loop. */
  yieldFn: () => Promise<void>;
};

/**
 * Same pixels as renderStaticScene, painted in slices of about `budgetMs`:
 * between two elements it awaits `yieldFn`, so one scene never holds the main
 * thread longer than the budget plus its slowest element.
 */
export const renderStaticSceneInSlices = async (
  config: StaticSceneRenderConfig,
  { budgetMs, yieldFn }: SceneSlicing,
) => {
  let sliceStart = performance.now();
  const steps = paintStaticScene(config, true);
  while (!steps.next().done) {
    if (performance.now() - sliceStart >= budgetMs) {
      await yieldFn();
      sliceStart = performance.now();
    }
  }
};

/** throttled to animation framerate */
export const renderStaticSceneThrottled = throttleRAF(
  (config: StaticSceneRenderConfig) => {
    _renderStaticScene(config);
  },
);

/**
 * Static scene is the non-ui canvas where we render elements.
 */
export const renderStaticScene = (
  renderConfig: StaticSceneRenderConfig,
  throttle?: boolean,
) => {
  if (throttle) {
    renderStaticSceneThrottled(renderConfig);
    return;
  }

  _renderStaticScene(renderConfig);
};
