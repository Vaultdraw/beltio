import { useCallback, useEffect, useRef } from "react";

import type { NonDeletedSceneElementsMap } from "@excalidraw/element/types";

import { isRenderThrottlingEnabled } from "../../reactUtils";
import { renderNewElementScene } from "../../renderer/renderNewElementScene";

import { primeLowMemoryCanvas } from "./lowMemoryCanvas";
import { useCanvasBackingStore } from "./useCanvasBackingStore";

import type {
  RenderableElementsMap,
  StaticCanvasRenderConfig,
} from "../../scene/types";
import type { AppState } from "../../types";
import type { RoughCanvas } from "roughjs/bin/canvas";

interface NewElementCanvasProps {
  appState: AppState;
  newElement: NonNullable<AppState["newElement"]>;
  elementsMap: RenderableElementsMap;
  allElementsMap: NonDeletedSceneElementsMap;
  scale: number;
  rc: RoughCanvas;
  renderConfig: StaticCanvasRenderConfig;
  /** CSS opacity of the whole canvas — a translucent preview of a finished element */
  opacity?: number;
}

const NewElementCanvas = (props: NewElementCanvasProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Primed when created, before any drawing, like the static and interactive canvases.
  const setCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    canvasRef.current = canvas;
    if (canvas) {
      primeLowMemoryCanvas(canvas, canvas.ownerDocument);
    }
  }, []);
  const getCanvas = useCallback(() => canvasRef.current, []);
  useCanvasBackingStore(
    getCanvas,
    props.appState.width * props.scale,
    props.appState.height * props.scale,
  );
  useEffect(() => {
    if (!canvasRef.current) {
      return;
    }
    renderNewElementScene(
      {
        canvas: canvasRef.current,
        scale: props.scale,
        newElement: props.newElement,
        elementsMap: props.elementsMap,
        allElementsMap: props.allElementsMap,
        rc: props.rc,
        renderConfig: props.renderConfig,
        appState: props.appState,
      },
      isRenderThrottlingEnabled(),
    );
  });

  return (
    <canvas
      className="excalidraw__canvas"
      style={{
        width: props.appState.width,
        height: props.appState.height,
        opacity: props.opacity,
      }}
      width={props.appState.width * props.scale}
      height={props.appState.height * props.scale}
      ref={setCanvas}
    />
  );
};

export default NewElementCanvas;
