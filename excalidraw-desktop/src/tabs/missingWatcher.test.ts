import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  affectedTabPaths,
  createMissingWatcher,
  markUnlistedMissing,
  probeExists,
  touchesPath,
} from "./missingWatcher";

type T = { id: string; path: string | null; missing?: boolean };

describe("touchesPath / affectedTabPaths", () => {
  it("matches the path itself and folder prefixes, not siblings", () => {
    expect(touchesPath("a/b.excalidraw", "a/b.excalidraw")).toBe(true);
    expect(touchesPath("a", "a/b.excalidraw")).toBe(true);
    expect(touchesPath("a/b", "a/bc.excalidraw")).toBe(false);
    expect(touchesPath("a/c.excalidraw", "a/b.excalidraw")).toBe(false);
  });
  it("rescan affects every drawing tab", () => {
    const tabs: T[] = [
      { id: "1", path: "x.excalidraw" },
      { id: "2", path: null },
    ];
    expect(affectedTabPaths([], tabs, true)).toEqual(["x.excalidraw"]);
    expect(affectedTabPaths(["y"], tabs, false)).toEqual([]);
  });
});

describe("createMissingWatcher", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = (tabs: T[], present: Set<string>, active = "1") => {
    const state = { tabs };
    const setMissing = vi.fn((path: string, m: boolean) => {
      state.tabs = state.tabs.map((t) =>
        t.path === path ? { ...t, missing: m } : t,
      );
    });
    const exists = vi.fn(async (p: string) => present.has(p));
    const w = createMissingWatcher({
      tabs: () => state.tabs,
      activeId: () => active,
      exists,
      setMissing,
      delayMs: 100,
    });
    return { w, state, setMissing, exists };
  };

  it("does nothing (no timer, no probe) for unrelated autosave events", async () => {
    const s = setup([{ id: "2", path: "b.excalidraw" }], new Set());
    s.w.onChange(["a.excalidraw"], false);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(500);
    expect(s.exists).not.toHaveBeenCalled();
  });

  it("marks a deleted background tab once, coalescing a burst", async () => {
    const s = setup([{ id: "2", path: "b.excalidraw" }], new Set());
    s.w.onChange(["b.excalidraw"], false);
    s.w.onChange(["b.excalidraw"], false);
    await vi.advanceTimersByTimeAsync(150);
    expect(s.exists).toHaveBeenCalledTimes(1);
    expect(s.setMissing).toHaveBeenCalledWith("b.excalidraw", true);
  });

  it("clears the mark when the file reappears", async () => {
    const s = setup(
      [{ id: "2", path: "b.excalidraw", missing: true }],
      new Set(["b.excalidraw"]),
    );
    s.w.onChange(["b.excalidraw"], false);
    await vi.advanceTimersByTimeAsync(150);
    expect(s.setMissing).toHaveBeenCalledWith("b.excalidraw", false);
  });

  it("an in-app rename (tab rebased before the event settles) is not marked", async () => {
    const s = setup(
      [{ id: "2", path: "old.excalidraw" }],
      new Set(["new.excalidraw"]),
    );
    s.w.onChange(["old.excalidraw", "new.excalidraw"], false);
    s.state.tabs = [{ id: "2", path: "new.excalidraw" }]; // controller.renamed
    await vi.advanceTimersByTimeAsync(150);
    expect(s.setMissing).not.toHaveBeenCalled();
  });

  it("an in-app trash (tab closed) is not marked", async () => {
    const s = setup([{ id: "2", path: "b.excalidraw" }], new Set());
    s.w.onChange(["b.excalidraw"], false);
    s.state.tabs = [];
    await vi.advanceTimersByTimeAsync(150);
    expect(s.setMissing).not.toHaveBeenCalled();
  });

  it("never marks the shown tab, but may clear a marked active one", async () => {
    const a = setup([{ id: "1", path: "a.excalidraw" }], new Set());
    a.w.onChange(["a.excalidraw"], false);
    await vi.advanceTimersByTimeAsync(150);
    expect(a.setMissing).not.toHaveBeenCalled();
    const b = setup(
      [{ id: "1", path: "a.excalidraw", missing: true }],
      new Set(["a.excalidraw"]),
    );
    b.w.onChange(["a.excalidraw"], false);
    await vi.advanceTimersByTimeAsync(150);
    expect(b.setMissing).toHaveBeenCalledWith("a.excalidraw", false);
  });

  it("a folder delete marks the tabs under it; dispose cancels", async () => {
    const s = setup([{ id: "2", path: "f/b.excalidraw" }], new Set());
    s.w.onChange(["f"], false);
    s.w.dispose();
    await vi.advanceTimersByTimeAsync(300);
    expect(s.setMissing).not.toHaveBeenCalled();
  });
});

describe("probeExists", () => {
  it("uses readRevision when available", async () => {
    const readRevision = vi.fn(async () => null);
    expect(
      await probeExists({ readRevision, listDirectory: vi.fn() }, "h", "a"),
    ).toBe(false);
  });
  it("falls back to the parent listing", async () => {
    const listDirectory = vi.fn(async () => [{ path: "f/a.excalidraw" }]);
    expect(await probeExists({ listDirectory }, "h", "f/a.excalidraw")).toBe(
      true,
    );
    expect(listDirectory).toHaveBeenCalledWith("h", "f");
  });
});

describe("markUnlistedMissing", () => {
  it("marks a tab missing when its file is gone, keeps one that exists or is listed", async () => {
    const marked: string[] = [];
    markUnlistedMissing(
      [
        { id: "1", path: "listed.excalidraw" },
        { id: "2", path: "gone.excalidraw" },
        { id: "3", path: "late.md" },
        { id: "4", path: "err.excalidraw" },
        { id: "5", path: null },
      ] as any,
      new Set(["listed.excalidraw"]),
      async (p) => {
        if (p === "err.excalidraw") {
          throw new Error("io");
        }
        return p === "late.md";
      },
      (p) => marked.push(p),
    );
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
    }
    expect(marked).toEqual(["gone.excalidraw"]);
  });
});
