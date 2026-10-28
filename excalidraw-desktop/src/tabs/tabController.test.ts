import { describe, expect, it, vi } from "vitest";

import { createTabsRuntime } from "./tabController";
import { fromSession } from "./tabsModel";

import type { TabsControllerDeps } from "./tabController";
import type { TabsState, ViewState } from "./types";

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
  reject: (e: unknown) => void;
};
const deferred = (): Deferred => {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const view = (n: number): ViewState => ({ scrollX: n, scrollY: n, zoom: 1 });

/** Fakes for the hook and editor. `gate` lets a test hold opens open. */
const setup = (
  opts: {
    session?: TabsState | null;
    gate?: (path: string) => Promise<void> | undefined;
    failPaths?: Set<string>;
    conflict?: () => boolean;
    closePinned?: boolean;
    /** Record `flush` calls (the live document is saved before a switch). */
    flush?: boolean;
    onNavigate?: () => void;
  } = {},
) => {
  const calls: string[] = [];
  const doc: { current: { path: string; revision: string } | null } = {
    current: null,
  };
  const editor = { view: view(1), undo: { stack: "u" } as unknown };
  const sessionSaves: TabsState[] = [];
  const onError = vi.fn();
  const onPinnedCloseBlocked = vi.fn();
  const deps: Omit<TabsControllerDeps, "store" | "memory"> & {
    undoBudgetBytes: number;
    initialState?: TabsState;
  } = {
    undoBudgetBytes: 1_000_000,
    initialState: opts.session ?? undefined,
    openDocument: async (path) => {
      calls.push(`open:${path}`);
      await opts.gate?.(path);
      if (opts.failPaths?.has(path)) {
        throw new Error(`cannot open ${path}`);
      }
      doc.current = { path, revision: "r1" };
    },
    closeDocument: async () => {
      calls.push("close");
      doc.current = null;
    },
    currentDocument: () => doc.current,
    captureEditor: () => (doc.current ? editor : null),
    estimateBytes: () => 10,
    isConflictBlocking: opts.conflict ?? (() => false),
    onError,
    onPinnedCloseBlocked,
    closePinnedWithShortcut: () => opts.closePinned ?? false,
    onNavigate: opts.onNavigate,
    session: { save: (s) => sessionSaves.push(s) },
    ...(opts.flush
      ? {
          flushDocument: async () => {
            calls.push(`flush:${doc.current?.path ?? ""}`);
          },
        }
      : {}),
  };
  const rt = createTabsRuntime(deps);
  return {
    ...rt,
    calls,
    doc,
    editor,
    sessionSaves,
    onError,
    onPinnedCloseBlocked,
  };
};

const paths = (s: TabsState) => s.tabs.map((t) => t.path);
const active = (s: TabsState) => s.tabs.find((t) => t.id === s.activeId)!;

/** Open "a" in the current (home) tab and "b" in a new tab; "b" is active. */
const twoTabs = async () => {
  const t = setup();
  await t.controller.openPath("a.excalidraw", { target: "current" });
  await t.controller.openPath("b.excalidraw", { target: "new" });
  t.calls.length = 0;
  t.sessionSaves.length = 0;
  return t;
};

describe("TabsController", () => {
  it("switch captures view+undo of the outgoing tab, then opens", async () => {
    const t = await twoTabs();
    const [a, b] = t.store.getState().tabs;
    t.editor.view = view(7);
    t.editor.undo = { stack: "b-undo" };
    await t.controller.activate(a.id);
    expect(t.calls).toEqual(["open:a.excalidraw"]);
    expect(t.store.getState().tabs[1].view).toEqual(view(7));
    expect(t.memory.take(b.id, "b.excalidraw", "r1")).toEqual({
      stack: "b-undo",
    });
  });

  it("a switch saves the outgoing drawing before the next opens, so background tabs hold no unsaved edits", async () => {
    const t = setup({ flush: true });
    await t.controller.openPath("a.excalidraw", { target: "current" });
    await t.controller.openPath("b.excalidraw", { target: "new" });
    expect(t.calls).toEqual([
      "open:a.excalidraw",
      "flush:a.excalidraw",
      "open:b.excalidraw",
    ]);
  });

  it("capture happens before the open", async () => {
    const t = setup();
    await t.controller.openPath("a.excalidraw", { target: "current" });
    const order: string[] = [];
    const origPut = t.memory.put.bind(t.memory);
    t.memory.put = (...args) => {
      order.push("put");
      origPut(...args);
    };
    t.calls.length = 0;
    await t.controller.openPath("b.excalidraw", { target: "new" });
    expect(order).toEqual(["put"]);
    expect(t.calls).toEqual(["open:b.excalidraw"]);
  });

  it("restore returns undo only on a matching revision", async () => {
    const t = await twoTabs();
    const [a] = t.store.getState().tabs;
    await t.controller.activate(a.id); // captures b
    t.editor.undo = { stack: "a-undo" };
    await t.controller.next(); // captures a, opens b
    expect(t.controller.takeRestore("b.excalidraw", "r1").undo).toBeDefined();
    // a: stale revision drops the undo but keeps the view
    const r = t.controller.takeRestore("a.excalidraw", "other");
    expect(r.undo).toBeUndefined();
    expect(r.view).toEqual(view(1));
    expect(t.controller.takeRestore("a.excalidraw", "r1").undo).toBeUndefined();
    expect(t.controller.pendingRestore("a.excalidraw")).toEqual({
      view: view(1),
    });
  });

  it("a conflict blocks the switch and leaves state unchanged", async () => {
    let blocked = true;
    const t = setup({ conflict: () => blocked });
    await t.controller.openPath("a.excalidraw", { target: "current" });
    await t.controller.openPath("b.excalidraw", { target: "new" });
    // first calls were refused too (home tab -> a was a switch): start clean
    expect(t.calls).toEqual([]);
    expect(paths(t.store.getState())).toEqual([null]);
    blocked = false;
    await t.controller.openPath("a.excalidraw", { target: "current" });
    await t.controller.openPath("b.excalidraw", { target: "new" });
    const before = t.store.getState();
    blocked = true;
    await t.controller.activate(before.tabs[0].id);
    expect(t.store.getState()).toBe(before);
    // a background close is not a switch, so it is allowed
    await t.controller.close(before.tabs[0].id);
    expect(paths(t.store.getState())).toEqual(["b.excalidraw"]);
  });

  it("open failure of a new tab closes it and returns to the previous tab", async () => {
    const t = setup({ failPaths: new Set(["bad.excalidraw"]) });
    await t.controller.openPath("a.excalidraw", { target: "current" });
    await t.controller.openPath("bad.excalidraw", { target: "new" });
    const s = t.store.getState();
    expect(paths(s)).toEqual(["a.excalidraw"]);
    expect(active(s).path).toBe("a.excalidraw");
    expect(s.closed).toEqual([]);
    expect(t.onError).toHaveBeenCalledTimes(1);
    expect(t.doc.current?.path).toBe("a.excalidraw");
  });

  it("open failure when replacing the current tab restores its old path", async () => {
    const t = setup({ failPaths: new Set(["bad.excalidraw"]) });
    await t.controller.openPath("a.excalidraw", { target: "current" });
    await t.controller.openPath("bad.excalidraw", { target: "current" });
    expect(paths(t.store.getState())).toEqual(["a.excalidraw"]);
    expect(t.onError).toHaveBeenCalledTimes(1);
    t.calls.length = 0;
    await t.controller.next(); // nothing to do, no reopen loop
    expect(t.calls).toEqual([]);
  });

  it("open failure on an existing tab rolls activation back", async () => {
    const failPaths = new Set<string>();
    const t = setup({ failPaths });
    await t.controller.openPath("a.excalidraw", { target: "current" });
    await t.controller.openPath("b.excalidraw", { target: "new" });
    const [a, b] = t.store.getState().tabs;
    failPaths.add("a.excalidraw");
    await t.controller.activate(a.id);
    const s = t.store.getState();
    expect(s.activeId).toBe(b.id);
    expect(s.tabs).toHaveLength(2);
    expect(t.doc.current?.path).toBe("b.excalidraw");
    expect(t.onError).toHaveBeenCalledTimes(1);
  });

  it("coalesces rapid activations: 3 activations, 1 extra open of the last target", async () => {
    const gates = new Map<string, Deferred>();
    const t = setup({
      gate: (p) => {
        if (!gates.has(p)) {
          return undefined;
        }
        return gates.get(p)!.promise;
      },
    });
    for (const p of ["a", "b", "c", "d"]) {
      await t.controller.openPath(`${p}.excalidraw`, { target: "new" });
    }
    // tabs: home?, a.. wait: first open replaced? target new keeps home tab
    const ids = t.store.getState().tabs.map((x) => x.id);
    t.calls.length = 0;
    const g = deferred();
    gates.set("a.excalidraw", g);
    const first = t.controller.activate(ids[1]); // a, held open
    t.controller.activate(ids[2]); // b
    t.controller.activate(ids[3]); // c
    t.controller.activate(ids[4]); // d, latest
    expect(t.calls).toEqual(["open:a.excalidraw"]);
    expect(active(t.store.getState()).path).toBe("d.excalidraw"); // strip updates at once
    g.resolve();
    await first;
    await t.controller.whenIdle();
    expect(t.calls).toEqual(["open:a.excalidraw", "open:d.excalidraw"]);
    expect(t.doc.current?.path).toBe("d.excalidraw");
  });

  it("move reorders without any IO", async () => {
    const t = await twoTabs();
    const [a, b] = t.store.getState().tabs;
    await t.controller.move(b.id, 0);
    expect(t.store.getState().tabs.map((x) => x.id)).toEqual([b.id, a.id]);
    expect(t.calls).toEqual([]);
  });

  it("marking a background tab missing does no IO; activating it shows the placeholder; clearing reopens", async () => {
    const t = await twoTabs();
    const [a] = t.store.getState().tabs;
    await t.controller.setMissing("a.excalidraw", true);
    expect(t.calls).toEqual([]);
    expect(t.store.getState().tabs[0].missing).toBe(true);
    await t.controller.activate(a.id);
    expect(t.calls).toEqual(["close"]);
    t.calls.length = 0;
    await t.controller.setMissing("a.excalidraw", false);
    expect(t.calls).toEqual(["open:a.excalidraw"]);
  });

  it("an in-app rename of a background tab keeps it unmarked", async () => {
    const t = await twoTabs();
    t.controller.renamed("a.excalidraw", "c.excalidraw");
    await t.controller.setMissing("a.excalidraw", true); // stale event for the old path
    expect(paths(t.store.getState())).toEqual(["c.excalidraw", "b.excalidraw"]);
    expect(t.store.getState().tabs[0].missing).toBeFalsy();
  });

  it("closing the active tab opens the MRU previous tab", async () => {
    const t = await twoTabs();
    const [a, b] = t.store.getState().tabs;
    await t.controller.close(b.id);
    expect(t.calls).toEqual(["open:a.excalidraw"]);
    expect(active(t.store.getState()).id).toBe(a.id);
    expect(t.memory.has(b.id)).toBe(false);
  });

  it("closing a background tab does no IO", async () => {
    const t = await twoTabs();
    const [a] = t.store.getState().tabs;
    await t.controller.close(a.id);
    expect(t.calls).toEqual([]);
    expect(paths(t.store.getState())).toEqual(["b.excalidraw"]);
  });

  it("a home tab unmounts the editor", async () => {
    const t = await twoTabs();
    await t.controller.newTab();
    expect(t.calls).toEqual(["close"]);
    expect(t.doc.current).toBeNull();
    t.calls.length = 0;
    await t.controller.mruNext();
    expect(t.calls).toEqual(["open:b.excalidraw"]);
  });

  it("Cmd+W on a pinned tab is blocked and calls back", async () => {
    const t = await twoTabs();
    const [a] = t.store.getState().tabs;
    await t.controller.togglePin(a.id);
    await t.controller.closeWithShortcut(a.id);
    expect(t.onPinnedCloseBlocked).toHaveBeenCalledTimes(1);
    expect(paths(t.store.getState())).toEqual(["a.excalidraw", "b.excalidraw"]);
    await t.controller.close(a.id); // context menu always works
    expect(paths(t.store.getState())).toEqual(["b.excalidraw"]);
  });

  it("Cmd+W closes pinned tabs when the setting allows it", async () => {
    const t = setup({ closePinned: true });
    await t.controller.openPath("a.excalidraw", { target: "current" });
    const id = t.store.getState().tabs[0].id;
    await t.controller.togglePin(id);
    await t.controller.closeWithShortcut(id);
    expect(t.onPinnedCloseBlocked).not.toHaveBeenCalled();
    expect(paths(t.store.getState())).toEqual([null]);
  });

  it("rename and remove propagate to memory", async () => {
    const t = await twoTabs();
    const [a, b] = t.store.getState().tabs;
    await t.controller.activate(a.id); // captures b under b.excalidraw
    t.controller.renamed("b.excalidraw", "x/b.excalidraw");
    expect(paths(t.store.getState())).toEqual([
      "a.excalidraw",
      "x/b.excalidraw",
    ]);
    expect(t.memory.take(b.id, "x/b.excalidraw", "r1")).toEqual({ stack: "u" });
    await t.controller.next(); // capture a
    expect(t.memory.has(a.id)).toBe(true); // captured when leaving a
  });

  it("removing a path closes its tabs and drops their memory", async () => {
    const t = await twoTabs();
    const [a, b] = t.store.getState().tabs;
    await t.controller.activate(a.id);
    expect(t.memory.has(b.id)).toBe(true);
    await t.controller.removed("b.excalidraw");
    expect(t.memory.has(b.id)).toBe(false);
    expect(paths(t.store.getState())).toEqual(["a.excalidraw"]);
    expect(t.calls).toEqual(["open:a.excalidraw"]);
  });

  it("renaming the open document does not reopen it", async () => {
    const t = await twoTabs();
    t.doc.current = { path: "x/b.excalidraw", revision: "r1" };
    t.controller.renamed("b.excalidraw", "x/b.excalidraw");
    await t.controller.whenIdle();
    expect(t.calls).toEqual([]);
  });

  it("replacing a tab's path drops its memory entry", async () => {
    const t = await twoTabs();
    const [a, b] = t.store.getState().tabs;
    await t.controller.activate(a.id);
    expect(t.memory.has(b.id)).toBe(true);
    await t.controller.activate(b.id);
    await t.controller.openPath("c.excalidraw", { target: "current" });
    expect(t.memory.has(b.id)).toBe(false);
  });

  it("restore opens only the active tab", async () => {
    const t = setup();
    await t.controller.restore({
      tabs: [
        { path: "a.excalidraw", pinned: false },
        { path: "b.excalidraw", pinned: false, view: view(3) },
        { path: null, pinned: false },
      ],
      activeIndex: 1,
      mru: [1, 0, 2],
    });
    expect(t.calls).toEqual(["open:b.excalidraw"]);
    expect(t.store.getState()).toEqual({
      ...fromSession({
        tabs: [
          { path: "a.excalidraw", pinned: false },
          { path: "b.excalidraw", pinned: false, view: view(3) },
          { path: null, pinned: false },
        ],
        activeIndex: 1,
        mru: [1, 0, 2],
      }),
    });
    expect(t.controller.pendingRestore("b.excalidraw")).toEqual({
      view: view(3),
    });
  });

  it("a restored active tab that cannot open is marked missing", async () => {
    const t = setup({ failPaths: new Set(["a.excalidraw"]) });
    await t.controller.restore({
      tabs: [{ path: "a.excalidraw", pinned: false }],
      activeIndex: 0,
      mru: [0],
    });
    expect(t.store.getState().tabs[0].missing).toBe(true);
    expect(t.calls).toEqual(["open:a.excalidraw", "close"]);
  });

  it("openCreated reuses a home tab without reopening", async () => {
    const t = setup();
    t.doc.current = { path: "n.excalidraw", revision: "r0" };
    await t.controller.openCreated("n.excalidraw");
    expect(t.calls).toEqual([]);
    expect(paths(t.store.getState())).toEqual(["n.excalidraw"]);
    // from a drawing tab: a new tab after it, still no reopen
    t.doc.current = { path: "m.excalidraw", revision: "r0" };
    await t.controller.openCreated("m.excalidraw");
    expect(t.calls).toEqual([]);
    expect(paths(t.store.getState())).toEqual(["n.excalidraw", "m.excalidraw"]);
    expect(active(t.store.getState()).path).toBe("m.excalidraw");
  });

  it("session.save runs on changes, not on no-ops", async () => {
    const t = await twoTabs();
    const [a] = t.store.getState().tabs;
    await t.controller.activate(a.id);
    expect(t.sessionSaves.length).toBeGreaterThan(0);
    t.sessionSaves.length = 0;
    await t.controller.activate(a.id); // already active
    await t.controller.goTo(99); // out of range
    await t.controller.reopenClosed(); // empty stack
    expect(t.sessionSaves).toEqual([]);
    expect(t.calls.filter((c) => c.startsWith("open"))).toEqual([
      "open:a.excalidraw",
    ]);
  });

  it("memory eviction exempts pinned tabs through the store", async () => {
    const t = await twoTabs();
    const [a, b] = t.store.getState().tabs;
    await t.controller.togglePin(b.id);
    t.memory.setBudget(15); // one 10-byte entry fits
    t.memory.put(a.id, {
      path: "a.excalidraw",
      revision: "r1",
      snapshot: 1,
      bytes: 10,
    });
    t.memory.put(b.id, {
      path: "b.excalidraw",
      revision: "r1",
      snapshot: 1,
      bytes: 10,
    });
    expect(t.memory.has(b.id)).toBe(true);
    expect(t.memory.has(a.id)).toBe(false);
  });

  it("controller overhead per switch is tiny with instant fakes", async () => {
    const t = await twoTabs();
    const [a, b] = t.store.getState().tabs;
    const n = 2000;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      await t.controller.activate(i % 2 === 0 ? a.id : b.id);
    }
    const per = (performance.now() - t0) / n;
    // eslint-disable-next-line no-console
    console.log(`tabController overhead per switch: ${per.toFixed(4)} ms`);
    expect(per).toBeLessThan(0.5);
  });
});

// Family: every way to move to a file or tab tells the host once, so a view
// covering the main area gives way (e2e/families/main-area-views.spec.ts).
describe("TabsController navigation hook", () => {
  it.each([
    ["openPath", (c: any) => c.openPath("c.excalidraw", { target: "new" })],
    [
      "openPath (already active)",
      (c: any) => c.openPath("b.excalidraw", { target: "current" }),
    ],
    ["openCreated", (c: any) => c.openCreated("n.excalidraw")],
    ["newTab", (c: any) => c.newTab()],
    ["activate", (c: any, s: any) => c.activate(s.getState().tabs[0].id)],
    ["next", (c: any) => c.next()],
    ["prev", (c: any) => c.prev()],
    ["goTo", (c: any) => c.goTo(1)],
    ["goToLast", (c: any) => c.goToLast()],
    ["mruNext", (c: any) => c.mruNext()],
    ["mruPrev", (c: any) => c.mruPrev()],
    ["reopenClosed", (c: any) => c.reopenClosed()],
  ])("%s calls onNavigate once", async (_name, act) => {
    const onNavigate = vi.fn();
    const t = setup({ onNavigate });
    await t.controller.openPath("a.excalidraw", { target: "current" });
    await t.controller.openPath("b.excalidraw", { target: "new" });
    onNavigate.mockClear();
    await act(t.controller, t.store);
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("closing a tab is not a navigation", async () => {
    const onNavigate = vi.fn();
    const t = setup({ onNavigate });
    await t.controller.openPath("a.excalidraw", { target: "current" });
    onNavigate.mockClear();
    await t.controller.close(t.store.getState().activeId);
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
