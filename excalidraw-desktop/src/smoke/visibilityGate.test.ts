import { describe, expect, it } from "vitest";

import { waitUntilRendering } from "./visibilityGate";

/** A fake window on a virtual clock: timers fire in order, rAF fires only when `frames` is true. */
function fakeWin(frames: boolean) {
  let now = 0;
  const win = {
    performance: { now: () => now },
    setTimeout: (fn: () => void, ms = 0) => {
      now += ms;
      queueMicrotask(fn);
      return 0;
    },
    requestAnimationFrame: (fn: FrameRequestCallback) => {
      if (frames) {
        queueMicrotask(() => fn(now));
      }
      return 0;
    },
  };
  return win as unknown as Window;
}

const opts = { visibleWaitMs: 1_000, frameWaitMs: 100 };

describe("waitUntilRendering", () => {
  it("passes a visible page", async () => {
    const r = await waitUntilRendering(
      fakeWin(true),
      { visibilityState: "visible" },
      false,
      opts,
    );
    expect(r).toEqual({ ok: true, hidden: false });
  });

  it("refuses a hidden page without hidden rendering", async () => {
    const r = await waitUntilRendering(
      fakeWin(true),
      { visibilityState: "hidden" },
      false,
      opts,
    );
    expect(r.ok).toBe(false);
  });

  it("accepts a hidden page that still renders when hidden rendering is on", async () => {
    const r = await waitUntilRendering(
      fakeWin(true),
      { visibilityState: "hidden" },
      true,
      opts,
    );
    expect(r).toEqual({ ok: true, hidden: true });
  });

  it("refuses a hidden page whose frames stopped, even with hidden rendering", async () => {
    const r = await waitUntilRendering(
      fakeWin(false),
      { visibilityState: "hidden" },
      true,
      opts,
    );
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/no frame/);
  });

  it("waits for a page that becomes visible", async () => {
    const doc = { visibilityState: "hidden" as DocumentVisibilityState };
    const win = fakeWin(false);
    const origSetTimeout = win.setTimeout;
    let ticks = 0;
    (win as { setTimeout: unknown }).setTimeout = (
      fn: () => void,
      ms: number,
    ) => {
      if (++ticks === 2) {
        doc.visibilityState = "visible";
      }
      return origSetTimeout(fn, ms);
    };
    const r = await waitUntilRendering(win, doc, false, opts);
    expect(r).toEqual({ ok: true, hidden: false });
  });
});
