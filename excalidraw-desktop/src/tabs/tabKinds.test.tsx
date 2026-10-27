import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ActiveTabGate } from "./ActiveTabGate";
import { createTabsRuntime } from "./tabController";
import {
  getTabKinds,
  isKindPath,
  registerTabKind,
  tabKindFor,
} from "./tabKinds";
import { createTabStore } from "./tabStore";
import { openPath } from "./tabsModel";

import type { TabKind, TabKindViewProps } from "./tabKinds";

const kind = (over: Partial<TabKind> = {}): TabKind => ({
  id: "t.note",
  pluginId: "t",
  matches: (p) => p.endsWith(".md"),
  load: async () => ({
    default: ({ path, openPath: open }: TabKindViewProps) => (
      <button onClick={() => open("other.md")}>view of {path}</button>
    ),
  }),
  ...over,
});

const disposers: Array<() => void> = [];
const register = (k: TabKind) => {
  const off = registerTabKind(k);
  disposers.push(off);
  return off;
};
afterEach(() => disposers.splice(0).forEach((off) => off()));

describe("tab kind registry", () => {
  it("matches nothing until a kind is registered, and again after dispose", () => {
    expect(tabKindFor("a.md")).toBeUndefined();
    const off = register(kind());
    expect(tabKindFor("a.md")?.id).toBe("t.note");
    expect(isKindPath("a.md")).toBe(true);
    expect(isKindPath("a.txt")).toBe(false);
    expect(isKindPath(null)).toBe(false);
    off();
    expect(getTabKinds()).toHaveLength(0);
  });

  it("refuses a duplicate id", () => {
    register(kind());
    expect(() => registerTabKind(kind())).toThrow(/already registered/);
  });

  it("never claims a drawing, even for a greedy matcher", () => {
    register(kind({ matches: () => true }));
    expect(tabKindFor("a.excalidraw")).toBeUndefined();
    expect(tabKindFor("A.EXCALIDRAW")).toBeUndefined();
    expect(tabKindFor("a.md")).toBeDefined();
  });

  it("the first registered kind wins a tie", () => {
    register(kind({ id: "a.k" }));
    register(kind({ id: "b.k" }));
    expect(tabKindFor("x.md")?.id).toBe("a.k");
  });
});

describe("controller with a kind tab", () => {
  it("closes the editor instead of opening a document, and settles", async () => {
    register(kind());
    const calls: string[] = [];
    const rt = createTabsRuntime({
      undoBudgetBytes: 1000,
      isCustomKind: isKindPath,
      openDocument: async (p) => void calls.push(`open:${p}`),
      closeDocument: async () => void calls.push("close"),
      currentDocument: () => null,
      captureEditor: () => null,
      estimateBytes: () => 1,
      isConflictBlocking: () => false,
      closePinnedWithShortcut: () => false,
    });
    await rt.controller.openPath("a.excalidraw", { target: "current" });
    await rt.controller.openPath("n.md", { target: "new" });
    await rt.controller.whenIdle();
    expect(calls).toEqual(["open:a.excalidraw", "close"]);
    // Back to the drawing reopens it; the note tab keeps its path.
    const [a] = rt.store.getState().tabs;
    await rt.controller.activate(a.id);
    expect(calls).toEqual(["open:a.excalidraw", "close", "open:a.excalidraw"]);
    expect(rt.store.getState().tabs.map((t) => t.path)).toEqual([
      "a.excalidraw",
      "n.md",
    ]);
  });
});

describe("ActiveTabGate with a kind", () => {
  it("renders the lazy view for a matching tab and routes openPath", async () => {
    register(kind());
    const store = createTabStore();
    store.update((s) => openPath(s, "f/n.md", { target: "current" }));
    const onOpenPath = vi.fn();
    render(
      <ActiveTabGate store={store} onOpenPath={onOpenPath}>
        <div>home</div>
      </ActiveTabGate>,
    );
    const btn = await screen.findByText("view of f/n.md");
    expect(screen.queryByText("home")).toBeNull();
    act(() => btn.click());
    expect(onOpenPath).toHaveBeenCalledWith("other.md", undefined);
  });

  it("shows the children for a drawing tab", () => {
    register(kind());
    const store = createTabStore();
    store.update((s) => openPath(s, "f/a.excalidraw", { target: "current" }));
    render(
      <ActiveTabGate store={store}>
        <div>home</div>
      </ActiveTabGate>,
    );
    expect(screen.getByText("home")).toBeTruthy();
  });

  it("shows a message when the view chunk fails to load", async () => {
    register(
      kind({
        load: () => Promise.reject(new Error("chunk gone")),
      }),
    );
    const store = createTabStore();
    store.update((s) => openPath(s, "n.md", { target: "current" }));
    render(
      <ActiveTabGate store={store}>
        <div>home</div>
      </ActiveTabGate>,
    );
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/chunk gone/),
    );
  });
});
