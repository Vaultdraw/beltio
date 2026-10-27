import React from "react";

import { Excalidraw } from "../index";
import {
  IDLE_SHRINK_MS,
  cancelIdleBackingStore,
  renderWithIdleBackingStore,
} from "../components/canvases/idleBackingStore";

import { API } from "./helpers/api";

import { render } from "./test-utils";

const makeCanvas = (w = 200, h = 100) => {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return canvas;
};

const draw = (canvas: HTMLCanvasElement) =>
  canvas.getContext("2d")!.fillRect(0, 0, 5, 5);

describe("idle backing store (unit)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shrinks at once when it has not painted since it got its size", () => {
    const canvas = makeCanvas();
    renderWithIdleBackingStore(canvas, () => 0);
    expect(canvas.width).toBe(1);
    expect(canvas.height).toBe(1);
    // a new size (resize) counts as fresh again
    renderWithIdleBackingStore(canvas, () => draw(canvas));
    canvas.width = 300;
    renderWithIdleBackingStore(canvas, () => 0);
    expect(canvas.width).toBe(1);
  });

  it("shrinks to 1x1 after 2 s of empty renders", () => {
    const canvas = makeCanvas();
    renderWithIdleBackingStore(canvas, () => draw(canvas));
    renderWithIdleBackingStore(canvas, () => 0);
    vi.advanceTimersByTime(IDLE_SHRINK_MS - 1);
    expect(canvas.width).toBe(200);
    vi.advanceTimersByTime(1);
    expect(canvas.width).toBe(1);
    expect(canvas.height).toBe(1);
  });

  it("keeps empty renders from restarting the timer", () => {
    const canvas = makeCanvas();
    renderWithIdleBackingStore(canvas, () => draw(canvas));
    renderWithIdleBackingStore(canvas, () => 0);
    vi.advanceTimersByTime(1500);
    renderWithIdleBackingStore(canvas, () => 0);
    vi.advanceTimersByTime(500);
    expect(canvas.width).toBe(1);
  });

  it("never shrinks while something is drawn", () => {
    const canvas = makeCanvas();
    for (let i = 0; i < 5; i++) {
      renderWithIdleBackingStore(canvas, () => draw(canvas));
      vi.advanceTimersByTime(1000);
    }
    expect(canvas.width).toBe(200);
  });

  it("a drawing render cancels a pending shrink", () => {
    const canvas = makeCanvas();
    renderWithIdleBackingStore(canvas, () => 0);
    vi.advanceTimersByTime(1500);
    renderWithIdleBackingStore(canvas, () => draw(canvas));
    vi.advanceTimersByTime(5000);
    expect(canvas.width).toBe(200);
  });

  it("restores and re-renders in the same call on the first non-empty render", () => {
    const canvas = makeCanvas();
    renderWithIdleBackingStore(canvas, () => 0);
    vi.advanceTimersByTime(IDLE_SHRINK_MS);
    expect(canvas.width).toBe(1);

    const sizesAtDraw: number[] = [];
    renderWithIdleBackingStore(canvas, () => {
      sizesAtDraw.push(canvas.width);
      draw(canvas);
    });
    expect(canvas.width).toBe(200);
    expect(canvas.height).toBe(100);
    // second pass ran on the restored canvas
    expect(sizesAtDraw).toEqual([1, 200]);
  });

  it("stays shrunk through empty renders", () => {
    const canvas = makeCanvas();
    renderWithIdleBackingStore(canvas, () => 0);
    vi.advanceTimersByTime(IDLE_SHRINK_MS);
    renderWithIdleBackingStore(canvas, () => 0);
    vi.advanceTimersByTime(IDLE_SHRINK_MS * 2);
    expect(canvas.width).toBe(1);
  });

  it("a resize while shrunk wins; the restore uses the new size", () => {
    const canvas = makeCanvas();
    renderWithIdleBackingStore(canvas, () => 0);
    vi.advanceTimersByTime(IDLE_SHRINK_MS);
    // what React does on a size or scale change
    canvas.width = 400;
    canvas.height = 300;
    renderWithIdleBackingStore(canvas, () => draw(canvas));
    expect(canvas.width).toBe(400);
    expect(canvas.height).toBe(300);
    // and it can shrink again, then restore to the newest size
    renderWithIdleBackingStore(canvas, () => 0);
    vi.advanceTimersByTime(IDLE_SHRINK_MS);
    expect(canvas.width).toBe(1);
    renderWithIdleBackingStore(canvas, () => draw(canvas));
    expect(canvas.width).toBe(400);
  });

  it("unmount cancels the timer and does not resurrect a released canvas", () => {
    const canvas = makeCanvas();
    renderWithIdleBackingStore(canvas, () => 0);
    cancelIdleBackingStore(canvas);
    canvas.width = 0;
    canvas.height = 0;
    vi.advanceTimersByTime(IDLE_SHRINK_MS * 2);
    expect(canvas.width).toBe(0);
  });

  it("instruments the context once, not per render", () => {
    const canvas = makeCanvas();
    const ctx = canvas.getContext("2d")!;
    renderWithIdleBackingStore(canvas, () => draw(canvas));
    const wrapper = ctx.fillRect;
    renderWithIdleBackingStore(canvas, () => draw(canvas));
    expect(ctx.fillRect).toBe(wrapper);
  });
});

describe("idle backing store (editor)", () => {
  beforeEach(() => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 400,
      bottom: 300,
      width: 400,
      height: 300,
      toJSON: () => ({}),
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("is 1x1 from mount with nothing to draw, full on select, 1x1 again when idle", async () => {
    const { container, unmount } = await render(<Excalidraw />);
    const canvas =
      container.querySelector<HTMLCanvasElement>("canvas.interactive")!;
    // nothing to draw since mount: never kept at full size
    expect(canvas.width).toBe(1);
    expect(canvas.style.width).not.toBe("");
    const fullWidth = Math.round(
      parseFloat(canvas.style.width) * window.devicePixelRatio,
    );

    const rect = API.createElement({
      type: "rectangle",
      x: 10,
      y: 10,
      width: 50,
      height: 50,
    });
    API.updateScene({ elements: [rect] });
    API.setSelectedElements([rect]);
    await new Promise((r) => setTimeout(r, 100));
    expect(canvas.width).toBe(fullWidth);

    // a selection is on screen: it must not shrink
    await new Promise((r) => setTimeout(r, IDLE_SHRINK_MS + 300));
    expect(canvas.width).toBe(fullWidth);

    // deselect: shrinks after the idle window, not at once
    API.setSelectedElements([]);
    await new Promise((r) => setTimeout(r, 100));
    expect(canvas.width).toBe(fullWidth);
    await new Promise((r) => setTimeout(r, IDLE_SHRINK_MS + 300));
    expect(canvas.width).toBe(1);

    unmount();
    expect(canvas.width).toBe(0);
  }, 15000);
});
