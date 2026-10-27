import React, { useEffect, useRef } from "react";

import { isShallowEqual } from "@excalidraw/common";

import type {
  NonDeletedExcalidrawElement,
  NonDeletedSceneElementsMap,
} from "@excalidraw/element/types";

import { isRenderThrottlingEnabled } from "../../reactUtils";
import { renderStaticScene } from "../../renderer/staticScene";

import type {
  RenderableElementsMap,
  StaticCanvasRenderConfig,
} from "../../scene/types";
import type { AppState, StaticCanvasAppState } from "../../types";
import type { RoughCanvas } from "roughjs/bin/canvas";

type StaticCanvasProps = {
  canvas: HTMLCanvasElement;
  rc: RoughCanvas;
  elementsMap: RenderableElementsMap;
  allElementsMap: NonDeletedSceneElementsMap;
  visibleElements: readonly NonDeletedExcalidrawElement[];
  canvasNonce: string;
  selectionNonce: number | undefined;
  scale: number;
  appState: StaticCanvasAppState;
  renderConfig: StaticCanvasRenderConfig;
};

const StaticCanvas = (props: StaticCanvasProps) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const isComponentMounted = useRef(false);
  /**
   * On mount appState still has the window's size (the editor measures its
   * container right after). Drawing at it allocates a full-window buffer plus
   * a display buffer that the first measure drops again (~38 MB at 2x). When
   * the container is already laid out at another size, size the canvas to it
   * and skip that one render; the measure's re-render draws.
   */
  const skipMountRender = useRef(false);

  useEffect(() => {
    let width = props.appState.width;
    let height = props.appState.height;
    if (!isComponentMounted.current) {
      const box = wrapperRef.current
        ?.closest(".excalidraw")
        ?.getBoundingClientRect();
      if (
        box &&
        box.width > 0 &&
        box.height > 0 &&
        (box.width !== width || box.height !== height)
      ) {
        ({ width, height } = box);
        skipMountRender.current = true;
      }
    }
    props.canvas.style.width = `${width}px`;
    props.canvas.style.height = `${height}px`;
    props.canvas.width = width * props.scale;
    props.canvas.height = height * props.scale;
    // free the backing store on unmount (WebKit holds it until GC); StrictMode
    // re-runs this effect, which restores the size
    const canvas = props.canvas;
    return () => {
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [props.appState.height, props.appState.width, props.canvas, props.scale]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      return;
    }

    const canvas = props.canvas;

    if (!isComponentMounted.current) {
      isComponentMounted.current = true;

      wrapper.replaceChildren(canvas);
      canvas.classList.add("excalidraw__canvas", "static");
    }

    if (skipMountRender.current) {
      skipMountRender.current = false;
      return;
    }

    renderStaticScene(
      {
        canvas,
        rc: props.rc,
        scale: props.scale,
        elementsMap: props.elementsMap,
        allElementsMap: props.allElementsMap,
        visibleElements: props.visibleElements,
        appState: props.appState,
        renderConfig: props.renderConfig,
      },
      isRenderThrottlingEnabled(),
    );
  });

  return <div className="excalidraw__canvas-wrapper" ref={wrapperRef} />;
};

const getRelevantAppStateProps = (appState: AppState): StaticCanvasAppState => {
  const relevantAppStateProps = {
    zoom: appState.zoom,
    scrollX: appState.scrollX,
    scrollY: appState.scrollY,
    width: appState.width,
    height: appState.height,
    viewModeEnabled: appState.viewModeEnabled,
    openDialog: appState.openDialog,
    hoveredElementIds: appState.hoveredElementIds,
    offsetLeft: appState.offsetLeft,
    offsetTop: appState.offsetTop,
    theme: appState.theme,
    shouldCacheIgnoreZoom: appState.shouldCacheIgnoreZoom,
    viewBackgroundColor: appState.viewBackgroundColor,
    viewBackgroundPattern: appState.viewBackgroundPattern,
    pageSetup: appState.pageSetup,
    exportBackgroundPattern: appState.exportBackgroundPattern,
    exportScale: appState.exportScale,
    selectedElementsAreBeingDragged: appState.selectedElementsAreBeingDragged,
    gridSize: appState.gridSize,
    gridStep: appState.gridStep,
    frameRendering: appState.frameRendering,
    selectedElementIds: appState.selectedElementIds,
    frameToHighlight: appState.frameToHighlight,
    editingGroupId: appState.editingGroupId,
    currentHoveredFontFamily: appState.currentHoveredFontFamily,
    croppingElementId: appState.croppingElementId,
    suggestedBinding: appState.suggestedBinding,
  };

  return relevantAppStateProps;
};

const areEqual = (
  prevProps: StaticCanvasProps,
  nextProps: StaticCanvasProps,
) => {
  if (
    prevProps.canvasNonce !== nextProps.canvasNonce ||
    prevProps.scale !== nextProps.scale ||
    // we need to memoize on elementsMap because they may have renewed
    // even if canvasNonce didn't change (e.g. we filter elements out based
    // on appState)
    prevProps.elementsMap !== nextProps.elementsMap ||
    prevProps.visibleElements !== nextProps.visibleElements
  ) {
    return false;
  }

  return (
    isShallowEqual(
      // asserting AppState because we're being passed the whole AppState
      // but resolve to only the StaticCanvas-relevant props
      getRelevantAppStateProps(prevProps.appState as AppState),
      getRelevantAppStateProps(nextProps.appState as AppState),
    ) && isShallowEqual(prevProps.renderConfig, nextProps.renderConfig)
  );
};

export default React.memo(StaticCanvas, areEqual);
