import { afterEach, describe, expect, it, vi } from "vitest";

import { sinceInput, waitForInputQuiet } from "./inputQuiet";

afterEach(() => {
  vi.useRealTimers();
});

describe("waitForInputQuiet", () => {
  it("resolves at once when there was no input", async () => {
    const win = new EventTarget() as unknown as Window;
    let done = false;
    void waitForInputQuiet(win, 150, 1000).then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(true);
    expect(sinceInput(win)).toBe(Infinity);
  });

  it("waits until input has been quiet for quietMs (a click counts)", async () => {
    vi.useFakeTimers();
    const win = window;
    sinceInput(win); // start tracking
    win.dispatchEvent(new MouseEvent("click"));
    let done = false;
    void waitForInputQuiet(win, 150, 1000).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(done).toBe(false);
    win.dispatchEvent(new KeyboardEvent("keydown"));
    await vi.advanceTimersByTimeAsync(100);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(60);
    expect(done).toBe(true);
  });

  it("gives up after maxMs while input keeps coming", async () => {
    vi.useFakeTimers();
    const win = window;
    sinceInput(win);
    let done = false;
    win.dispatchEvent(new MouseEvent("click"));
    void waitForInputQuiet(win, 150, 300).then(() => {
      done = true;
    });
    for (let t = 0; t < 280; t += 40) {
      win.dispatchEvent(new Event("pointerdown"));
      await vi.advanceTimersByTimeAsync(40);
    }
    await vi.advanceTimersByTimeAsync(30);
    expect(done).toBe(true);
  });
});
