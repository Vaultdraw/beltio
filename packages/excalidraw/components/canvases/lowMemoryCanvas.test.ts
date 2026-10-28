import { describe, expect, it, vi } from "vitest";

import { primeLowMemoryCanvas } from "./lowMemoryCanvas";

const makeDoc = (flag: boolean | undefined) => {
  const getContext = vi.fn(() => ({}));
  const canvas = { getContext } as unknown as HTMLCanvasElement;
  const doc = {
    defaultView: { EXCALIDRAW_LOW_MEMORY_CANVAS: flag },
  } as unknown as Document;
  return { canvas, doc, getContext };
};

describe("primeLowMemoryCanvas", () => {
  it("does nothing unless the host switch is on (zero cost by default)", () => {
    for (const flag of [undefined, false]) {
      const { canvas, doc, getContext } = makeDoc(flag);
      expect(primeLowMemoryCanvas(canvas, doc)).toBe(false);
      expect(getContext).not.toHaveBeenCalled();
    }
  });

  it("asks for a CPU-backed context before anything draws when the switch is on", () => {
    const { canvas, doc, getContext } = makeDoc(true);
    expect(primeLowMemoryCanvas(canvas, doc)).toBe(true);
    expect(getContext).toHaveBeenCalledWith("2d", { willReadFrequently: true });
  });
});
