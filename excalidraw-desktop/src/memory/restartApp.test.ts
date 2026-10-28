import { describe, expect, it } from "vitest";

import {
  lowMemoryCanvasNeedsRestart,
  runningLowMemoryCanvas,
} from "./restartApp";

const win = (flag?: boolean) =>
  ({ EXCALIDRAW_LOW_MEMORY_CANVAS: flag } as unknown as Window);

describe("low-memory canvas restart", () => {
  it("running value comes from the window flag set at startup", () => {
    expect(runningLowMemoryCanvas(win())).toBe(false);
    expect(runningLowMemoryCanvas(win(true))).toBe(true);
  });
  it("needs a restart only when the saved value differs from the running one", () => {
    expect(lowMemoryCanvasNeedsRestart(false, win())).toBe(false);
    expect(lowMemoryCanvasNeedsRestart(true, win())).toBe(true);
    expect(lowMemoryCanvasNeedsRestart(true, win(true))).toBe(false);
    expect(lowMemoryCanvasNeedsRestart(false, win(true))).toBe(true);
  });
});
