import React from "react";

import { Excalidraw } from "../index";

import { render } from "./test-utils";

// On mount appState has the window's size; the container is measured right
// after. A laid-out container of another size must not get a window-sized
// static backing store first (StaticCanvas skipMountRender).
describe("static canvas size at mount", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is never sized to the window when the container is smaller", async () => {
    const sizes: number[] = [];
    const proto = HTMLCanvasElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "width")!;
    vi.spyOn(proto, "width", "set").mockImplementation(function (
      this: HTMLCanvasElement,
      v: number,
    ) {
      if (this.classList.contains("static") || !this.isConnected) {
        sizes.push(v);
      }
      desc.set!.call(this, v);
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
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
    const { container } = await render(<Excalidraw />);
    const canvas = container.querySelector<HTMLCanvasElement>("canvas.static")!;
    expect(canvas.style.width).toBe("400px");
    expect(sizes).not.toContain(window.innerWidth * window.devicePixelRatio);
  });
});
