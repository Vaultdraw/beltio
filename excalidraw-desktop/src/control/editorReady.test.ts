import { afterEach, describe, expect, it, vi } from "vitest";

import { waitForEditor } from "./editorReady";
import { createAppFiles } from "./appFiles";

afterEach(() => vi.useRealTimers());

// Hunter C, C-10 member 3: `open X` answered before the editor could be read, so a script's next
// `scene read` failed with "No drawing is open".
describe("waitForEditor", () => {
  it("answers at once when the editor already shows the drawing (any case, any Unicode form)", async () => {
    expect(
      await waitForEditor("A/Plan.excalidraw", {
        current: () => ({ path: "a/plan.excalidraw" }),
      }),
    ).toBe(true);
    expect(
      await waitForEditor("Café.excalidraw", {
        current: () => ({ path: "Café.excalidraw" }),
      }),
    ).toBe(true);
  });

  it("waits for the editor to switch to the drawing, on a notice and on a rename", async () => {
    let path: string | null = null;
    let notify = () => {};
    const p = waitForEditor("X.excalidraw", {
      current: () => ({ path }),
      subscribe: (cb) => {
        notify = cb;
        return () => {};
      },
    });
    path = "Other.excalidraw";
    notify();
    path = "X.excalidraw";
    notify();
    expect(await p).toBe(true);
  });

  it("gives up with false after the time limit and cleans up its timers", async () => {
    vi.useFakeTimers();
    const unsub = vi.fn();
    const p = waitForEditor("X.excalidraw", {
      current: () => null,
      subscribe: () => unsub,
      ms: 300,
    });
    await vi.advanceTimersByTimeAsync(400);
    expect(await p).toBe(false);
    expect(unsub).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("app files answer once the editor shows the drawing", () => {
  const files = (editorReady: (p: string) => Promise<boolean>) =>
    createAppFiles({
      vault: null,
      repository: {} as never,
      active: null,
      tabStore: null,
      openVaultAt: vi.fn(),
      openDrawing: async () => true,
      createEntry: vi.fn(),
      moveEntry: vi.fn(),
      trashEntry: vi.fn(),
      win: null,
      flushIfOpen: vi.fn(),
      busy: (run) => run(),
      editorReady,
    });

  it("open returns true when the editor is ready", async () => {
    const ready = vi.fn().mockResolvedValue(true);
    expect(await files(ready).openDrawing("A.excalidraw", false)).toBe(true);
    expect(ready).toHaveBeenCalledWith("A.excalidraw");
  });

  it("open says plainly when the editor does not come up in time", async () => {
    await expect(
      files(async () => false).openDrawing("A.excalidraw", false),
    ).rejects.toMatchObject({
      code: "UNAVAILABLE",
      message: expect.stringContaining("still loading"),
    });
  });
});
