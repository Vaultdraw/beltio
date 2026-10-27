import { afterEach, describe, expect, it, vi } from "vitest";

import { canvasCensus, installCanvasTracker } from "./canvasTracker";
import {
  footprintTraceText,
  setPerfStep,
  startFootprintTrace,
} from "./footprintTrace";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

describe("memory probe (perf builds)", () => {
  afterEach(() => {
    vi.useRealTimers();
    invoke.mockReset();
  });

  it("lists big live canvases and their resizes, not small ones", () => {
    installCanvasTracker(window);
    const big = document.createElement("canvas");
    big.width = 1000;
    big.height = 500;
    big.getContext("2d");
    const small = document.createElement("canvas");
    small.width = 10;
    small.height = 10;
    small.getContext("2d");
    big.height = 600;

    const text = canvasCensus();
    expect(text).toMatch(/^2\.3 MB 1000x600 detached 2d/);
    expect(text).not.toMatch(/10x10/);
    expect(text).toMatch(/height 500->600 now 1000x600 detached/);
    expect(text).toMatch(/live canvases 2,/);
  });

  it("logs a lifetime peak rise with the step that was running", async () => {
    vi.useFakeTimers();
    const MB = 1048576;
    invoke.mockResolvedValueOnce([[11, 100 * MB, 100 * MB]]);
    invoke.mockResolvedValueOnce([[11, 101 * MB, 101 * MB]]);
    invoke.mockResolvedValueOnce([[11, 90 * MB, 130 * MB]]);
    const stop = startFootprintTrace(window, { webContent: 11, network: 12 });

    setPerfStep("open a");
    await vi.advanceTimersByTimeAsync(50);
    await vi.advanceTimersByTimeAsync(50);
    setPerfStep("pan");
    await vi.advanceTimersByTimeAsync(50);
    stop();

    expect(invoke).toHaveBeenCalledWith("perf_footprint", { pids: [11] });
    const lines = footprintTraceText().split("\n");
    // the 1 MB rise is below the 2 MB threshold
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/\[open a\] webContent=100\/100$/);
    expect(lines[1]).toMatch(/\[pan\] webContent=90\/130$/);
  });
});
