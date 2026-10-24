import { afterEach, describe, expect, it, vi } from "vitest";

import { revealTab } from "./revealTab";

const tab = () => {
  const el = document.createElement("div");
  el.scrollIntoView = vi.fn();
  document.body.append(el);
  return el;
};

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("revealTab", () => {
  it("scrolls at once when not deferred", () => {
    const el = tab();
    revealTab(el, { deferred: false });
    expect(el.scrollIntoView).toHaveBeenCalledWith({
      block: "nearest",
      inline: "nearest",
    });
  });

  it("waits for the next frame when deferred, then scrolls", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
      frames.push(cb),
    );
    const el = tab();
    revealTab(el, { deferred: true });
    expect(el.scrollIntoView).not.toHaveBeenCalled();
    frames[0](0);
    expect(el.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("cancel drops the pending frame; a removed tab is skipped", () => {
    const frames: FrameRequestCallback[] = [];
    const cancelled: number[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
      frames.push(cb),
    );
    vi.stubGlobal("cancelAnimationFrame", (h: number) => cancelled.push(h));
    const a = tab();
    revealTab(a, { deferred: true })();
    expect(cancelled).toEqual([1]);
    const b = tab();
    revealTab(b, { deferred: true });
    b.remove();
    frames[1](0);
    expect(b.scrollIntoView).not.toHaveBeenCalled();
  });

  it("ignores a missing element", () => {
    expect(() => revealTab(null, { deferred: true })()).not.toThrow();
  });
});
