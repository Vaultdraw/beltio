import rough from "roughjs/bin/rough";
import { describe, expect, it, vi } from "vitest";

import { arrayToMap } from "@excalidraw/common";
import { newLinearElement } from "@excalidraw/element";

import { getDefaultAppState } from "../appState";

import {
  getNewElementRoughCanvas,
  renderNewElementScene,
} from "./renderNewElementScene";

describe("renderNewElementScene", () => {
  it("strokes a line being drawn with the new-element canvas's own rough canvas", () => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 400;
    // the editor's shared rough canvas belongs to ANOTHER (static) canvas
    const staticRc = rough.canvas(document.createElement("canvas"));
    const staticDraw = vi.spyOn(staticRc, "draw");
    const ownDraw = vi.spyOn(getNewElementRoughCanvas(canvas), "draw");

    const line = newLinearElement({
      type: "line",
      x: 300,
      y: 200,
      points: [
        [0, 0],
        [200, 120],
      ] as any,
    } as any);
    const map = arrayToMap([line]) as any;
    renderNewElementScene({
      canvas,
      rc: staticRc,
      newElement: line,
      elementsMap: map,
      allElementsMap: map,
      scale: 1,
      appState: { ...getDefaultAppState(), width: 400, height: 400 } as any,
      renderConfig: {
        imageCache: new Map(),
        isExporting: false,
        renderGrid: false,
        canvasBackgroundColor: "#fff",
        embedsValidationStatus: new Map(),
        elementsPendingErasure: new Set(),
        pendingFlowchartNodes: null,
        theme: "light",
      } as any,
    });

    expect(staticDraw).not.toHaveBeenCalled();
    expect(ownDraw).toHaveBeenCalled();
    expect(getNewElementRoughCanvas(canvas)).toBe(
      getNewElementRoughCanvas(canvas),
    );
  });
});
