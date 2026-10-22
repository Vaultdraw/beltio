import {
  applyDarkModeFilter,
  COLOR_WHITE,
  FRAME_STYLE,
  THEME,
  throttleRAF,
} from "@excalidraw/common";
import {
  isElementLink,
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

import {
  EXTERNAL_LINK_IMG,
  ELEMENT_LINK_IMG,
  getLinkHandleFromCoords,
} from "../components/hyperlink/helpers";

import { isPageModeOn } from "../data/pageSetup";

import { renderBackgroundPattern } from "./backgroundPattern";
import { renderPageSurround } from "./pageFrame";

import {
  bootstrapCanvas,
  getNormalizedCanvasDimensions,
  snapScrollToDevicePixels,
} from "./helpers";

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

type LinkIconCanvas = HTMLCanvasElement & { zoom: number };

const linkIconCanvasCache: {
  regularLink: LinkIconCanvas | null;
  elementLink: LinkIconCanvas | null;
} = {
  regularLink: null,
  elementLink: null,
};

const renderLinkIcon = (
  element: NonDeletedExcalidrawElement,
  context: CanvasRenderingContext2D,
  appState: StaticCanvasAppState,
  elementsMap: ElementsMap,
  renderState: ElementRenderState,
) => {
  if (element.link && !appState.selectedElementIds[element.id]) {
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
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    context.save();
    context.translate(appState.scrollX + centerX, appState.scrollY + centerY);
    context.rotate(element.angle);

    const canvasKey = isElementLink(element.link)
      ? "elementLink"
      : "regularLink";

    let linkCanvas = linkIconCanvasCache[canvasKey];

    if (!linkCanvas || linkCanvas.zoom !== appState.zoom.value) {
      linkCanvas = Object.assign(document.createElement("canvas"), {
        zoom: appState.zoom.value,
      });
      linkCanvas.width = width * window.devicePixelRatio * appState.zoom.value;
      linkCanvas.height =
        height * window.devicePixelRatio * appState.zoom.value;
      linkIconCanvasCache[canvasKey] = linkCanvas;

      const linkCanvasCacheContext = linkCanvas.getContext("2d")!;
      linkCanvasCacheContext.scale(
        window.devicePixelRatio * appState.zoom.value,
        window.devicePixelRatio * appState.zoom.value,
      );

      // Seed a sane default so a corrupted color (silently rejected by the
      // canvas) falls back to white instead of a stale fillStyle.
      linkCanvasCacheContext.fillStyle = COLOR_WHITE;
      linkCanvasCacheContext.fillStyle =
        appState.viewBackgroundColor || COLOR_WHITE;

      linkCanvasCacheContext.fillRect(0, 0, width, height);

      if (canvasKey === "elementLink") {
        linkCanvasCacheContext.drawImage(ELEMENT_LINK_IMG, 0, 0, width, height);
      } else {
        linkCanvasCacheContext.drawImage(
          EXTERNAL_LINK_IMG,
          0,
          0,
          width,
          height,
        );
      }

      linkCanvasCacheContext.restore();
    }
    context.globalAlpha = renderState.opacity;
    context.drawImage(linkCanvas, x - centerX, y - centerY, width, height);
    context.restore();
  }
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
        renderLinkIcon(element, context, appState, elementsMap, renderState);
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
          renderLinkIcon(element, context, appState, elementsMap, renderState);
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
