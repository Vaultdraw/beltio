import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import NewElementCanvas from "./NewElementCanvas";

vi.mock("../../renderer/renderNewElementScene", () => ({
  renderNewElementScene: vi.fn(),
}));
vi.mock("./useCanvasBackingStore", () => ({
  useCanvasBackingStore: vi.fn(),
}));

const props = {
  appState: { width: 100, height: 100 },
  newElement: {},
  elementsMap: new Map(),
  allElementsMap: new Map(),
  scale: 1,
  rc: {},
  renderConfig: {},
} as any;

describe("NewElementCanvas low-memory canvas", () => {
  afterEach(() => {
    delete (window as any).EXCALIDRAW_LOW_MEMORY_CANVAS;
    vi.restoreAllMocks();
  });

  it("asks for a CPU-backed context when the host switch is on", () => {
    (window as any).EXCALIDRAW_LOW_MEMORY_CANVAS = true;
    const spy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue({} as any);
    render(<NewElementCanvas {...props} />);
    expect(spy).toHaveBeenCalledWith("2d", { willReadFrequently: true });
  });

  it("does not touch the context when the switch is off", () => {
    const spy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue({} as any);
    render(<NewElementCanvas {...props} />);
    expect(spy).not.toHaveBeenCalled();
  });
});
