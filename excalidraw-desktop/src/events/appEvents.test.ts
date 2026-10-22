import { describe, expect, it, vi } from "vitest";

import { appEvents } from "./appEvents";

describe("appEvents", () => {
  it("gates on listeners and delivers payloads", () => {
    expect(appEvents.hasListeners("drawing.saved")).toBe(false);
    const cb = vi.fn();
    const off = appEvents.on("drawing.saved", cb);
    expect(appEvents.hasListeners("drawing.saved")).toBe(true);
    appEvents.emit("drawing.saved", { path: "a.excalidraw" });
    appEvents.emit("drawing.deleted", { path: "x" });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({ path: "a.excalidraw" });
    off();
    expect(appEvents.hasListeners("drawing.saved")).toBe(false);
    appEvents.emit("drawing.saved", { path: "b" });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("isolates a throwing listener", () => {
    const ok = vi.fn();
    const o1 = appEvents.on("drawing.renamed", () => {
      throw new Error("x");
    });
    const o2 = appEvents.on("drawing.renamed", ok);
    appEvents.emit("drawing.renamed", { from: "a", to: "b" });
    expect(ok).toHaveBeenCalledWith({ from: "a", to: "b" });
    o1();
    o2();
  });

  it("bench: emit with 0 listeners", () => {
    const n = 1_000_000;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      appEvents.emit("vault.opened", { name: "v" });
    }
    const ns = ((performance.now() - t0) / n) * 1e6;
    // eslint-disable-next-line no-console
    console.info(`appEvents.emit, 0 listeners: ${ns.toFixed(1)} ns`);
    expect(ns).toBeLessThan(1000);
  });
});
