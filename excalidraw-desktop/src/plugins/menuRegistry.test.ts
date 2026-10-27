import { afterEach, describe, expect, it, vi } from "vitest";

import { buildEntries } from "../tabs/TabContextMenu";

import {
  addMenuItems,
  beginMenuRun,
  getMenuItems,
  getMenuTarget,
  runMenuItem,
  type MenuItemStub,
} from "./menuRegistry";

vi.mock("./host/runner", () => ({
  runCommandById: vi.fn(async () => {}),
}));

const stub = (over: Partial<MenuItemStub> = {}): MenuItemStub => ({
  pluginId: "p",
  pluginName: "P",
  surface: "tree",
  title: "Do it",
  command: "p.go",
  kinds: [],
  ...over,
});

const offs: Array<() => void> = [];
afterEach(() => offs.splice(0).forEach((off) => off()));
const add = (...items: MenuItemStub[]) => {
  const off = addMenuItems(items);
  offs.push(off);
  return off;
};

describe("menu registry", () => {
  it("is one shared empty array without plugins, then lists per surface in order", () => {
    const none = getMenuItems("tab");
    expect(getMenuItems("tree")).toBe(none);
    const a = stub();
    const b = stub({ surface: "tab", title: "Tab one" });
    const c = stub({ title: "Second" });
    const off = add(a, b, c);
    expect(getMenuItems("tree")).toEqual([a, c]);
    expect(getMenuItems("tab")).toEqual([b]);
    expect(getMenuItems("canvas")).toEqual([]);
    expect(getMenuItems("tree")).toBe(getMenuItems("tree"));
    off();
    expect(getMenuItems("tree")).toEqual([]);
  });

  it("the tab menu appends the plugin items after the built-in ones", () => {
    const tab = { id: "t1", path: "a.excalidraw", pinned: false };
    const before = buildEntries({ tab }).map((e) => e.label);
    add(stub({ surface: "tab", title: "Plugin thing" }));
    const after = buildEntries({ tab });
    expect(after.map((e) => e.label)).toEqual([...before, "", "Plugin thing"]);
    expect(after.at(-1)?.action).toBe("plugin:0");
  });

  it("a target is readable only while the command a menu item started runs", () => {
    const item = stub();
    runMenuItem(item, {
      surface: "tree",
      path: "a.excalidraw",
      kind: "drawing",
    });
    const end = beginMenuRun("p", "p.go");
    expect(getMenuTarget("p")).toEqual({
      surface: "tree",
      path: "a.excalidraw",
      kind: "drawing",
    });
    expect(getMenuTarget("other")).toBeNull();
    end();
    expect(getMenuTarget("p")).toBeNull();
    // A later run of the command (the palette) has no target.
    const again = beginMenuRun("p", "p.go");
    expect(getMenuTarget("p")).toBeNull();
    again();
  });

  it("a target is for the command it was chosen for, once", () => {
    runMenuItem(stub(), { surface: "tab", path: null });
    const wrong = beginMenuRun("p", "p.other");
    expect(getMenuTarget("p")).toBeNull();
    wrong();
    const right = beginMenuRun("p", "p.go");
    expect(getMenuTarget("p")).toBeNull();
    right();
  });
});
