import React from "react";
import { vi } from "vitest";

import * as Element from "@excalidraw/element";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import {
  act,
  mockBoundingClientRect,
  render,
  restoreOriginalGetBoundingClientRect,
} from "./test-utils";

import type { NormalizedZoomValue } from "../types";

const { h } = window;

/** zoom of each cached bitmap (elements on screen) */
const zoomsOfCached = (): number[] =>
  h.elements
    .map((element) => Element.elementWithCanvasCache.get(element)?.zoomValue)
    .filter((zoom): zoom is NormalizedZoomValue => zoom !== undefined);

const nextFrame = () =>
  act(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );

describe("progressive crisp-up after a zoom", () => {
  beforeEach(() => {
    mockBoundingClientRect();
  });
  afterEach(() => {
    restoreOriginalGetBoundingClientRect();
    Element.setZoomRefreshEnabled(false);
    vi.restoreAllMocks();
  });

  it("re-rasterises a few bitmaps in the render, draws the rest from the old ones, finishes them in idle slices and redraws once", async () => {
    await render(<Excalidraw />);
    API.setElements(
      Array.from({ length: 20 }, (_, i) =>
        API.createElement({
          type: "rectangle",
          id: `r${i}`,
          x: 0,
          y: i,
          width: 20,
          height: 20,
        }),
      ),
    );
    await nextFrame();
    expect(zoomsOfCached().length).toBeGreaterThan(8);
    expect(new Set(zoomsOfCached())).toEqual(new Set([1]));

    Element.setZoomRefreshEnabled(true);
    // every clock read is 5 ms later: the frame budget runs out right away,
    // so each frame re-rasterises only its guaranteed minimum
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (clock += 5));

    act(() => {
      h.setState({
        zoom: { value: 1.5 as NormalizedZoomValue },
        shouldCacheIgnoreZoom: false,
      });
    });
    const afterFirst = zoomsOfCached();
    expect(afterFirst.filter((z) => z === 1.5).length).toBeGreaterThan(0);
    expect(afterFirst.filter((z) => z === 1).length).toBeGreaterThan(0);
    expect(Element.didDeferZoomRefresh()).toBe(true);

    for (let i = 0; i < 40 && zoomsOfCached().includes(1); i++) {
      await nextFrame();
    }
    expect(new Set(zoomsOfCached())).toEqual(new Set([1.5]));
  });
});
