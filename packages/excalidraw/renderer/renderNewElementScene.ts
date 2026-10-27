import rough from "roughjs/bin/rough";

import { throttleRAF } from "@excalidraw/common";

import {
  getTargetFrame,
  isInvisiblySmallElement,
  renderElement,
  shouldApplyFrameClip,
} from "@excalidraw/element";

import {
  bootstrapCanvas,
  getNormalizedCanvasDimensions,
  snapScrollToDevicePixels,
} from "./helpers";

import { frameClip } from "./staticScene";

import type { NewElementSceneRenderConfig } from "../scene/types";
import type { RoughCanvas } from "roughjs/bin/canvas";

// Arrows and lines are drawn straight onto the context (no per-element
// bitmap), and rough.js strokes onto the canvas its RoughCanvas was made for.
// The editor's shared `rc` belongs to the static canvas, so using it here drew
// the element being created on the static canvas at scene (0, 0) until pointer
// up. This canvas gets its own, made once.
const roughCanvases = new WeakMap<HTMLCanvasElement, RoughCanvas>();
export const getNewElementRoughCanvas = (canvas: HTMLCanvasElement) => {
  let rc = roughCanvases.get(canvas);
  if (!rc) {
    rc = rough.canvas(canvas);
    roughCanvases.set(canvas, rc);
  }
  return rc;
};

const _renderNewElementScene = ({
  canvas,
  newElement,
  elementsMap,
  allElementsMap,
  scale,
  appState: unsnappedAppState,
  renderConfig,
}: NewElementSceneRenderConfig) => {
  if (canvas) {
    // the same whole-device-pixel scroll the static scene draws at
    const appState = snapScrollToDevicePixels(unsnappedAppState, scale);
    const [normalizedWidth, normalizedHeight] = getNormalizedCanvasDimensions(
      canvas,
      scale,
    );

    const context = bootstrapCanvas({
      canvas,
      scale,
      normalizedWidth,
      normalizedHeight,
    });

    context.save();

    // Apply zoom
    context.scale(appState.zoom.value, appState.zoom.value);

    if (newElement && newElement.type !== "selection") {
      // e.g. when creating arrows and we're still below the arrow drag distance
      // threshold
      // (for now we skip render only with elements while we're creating to be
      // safe)
      if (isInvisiblySmallElement(newElement)) {
        return;
      }

      const frameId = newElement.frameId || appState.frameToHighlight?.id;

      if (
        frameId &&
        appState.frameRendering.enabled &&
        appState.frameRendering.clip
      ) {
        const frame = getTargetFrame(newElement, elementsMap, appState);

        if (
          frame &&
          shouldApplyFrameClip(newElement, frame, appState, elementsMap)
        ) {
          frameClip(frame, context, renderConfig, appState);
        }
      }

      const renderTargetElement = newElement;

      renderElement(
        renderTargetElement,
        elementsMap,
        allElementsMap,
        getNewElementRoughCanvas(canvas),
        context,
        renderConfig,
        appState,
      );
    } else {
      context.clearRect(0, 0, normalizedWidth, normalizedHeight);
    }

    context.restore();
  }
};

export const renderNewElementSceneThrottled = throttleRAF(
  (config: NewElementSceneRenderConfig) => {
    _renderNewElementScene(config);
  },
);

export const renderNewElementScene = (
  renderConfig: NewElementSceneRenderConfig,
  throttle?: boolean,
) => {
  if (throttle) {
    renderNewElementSceneThrottled(renderConfig);
    return;
  }

  _renderNewElementScene(renderConfig);
};
