import { describe, expect, it, vi } from "vitest";

import { treeActions, type TreeKeyDeps } from "./treeKeys";

import type { VaultEntry } from "../../vault/types";
import type { TreeRow } from "./flattenTree";

const entry = (path: string, kind: VaultEntry["kind"]): VaultEntry => ({
  path,
  name: path.split("/").pop()!,
  kind,
  modifiedAt: 0,
  size: 0,
});
// a/ (open) > a/x.excalidraw ; b/ (closed) ; c.excalidraw
const ROWS: TreeRow[] = [
  { entry: entry("a", "folder"), depth: 0, expanded: true },
  { entry: entry("a/x.excalidraw", "drawing"), depth: 1, expanded: false },
  { entry: entry("b", "folder"), depth: 0, expanded: false },
  { entry: entry("c.excalidraw", "drawing"), depth: 0, expanded: false },
];

const deps = (focusedPath: string | null, over: Partial<TreeKeyDeps> = {}) => {
  const d: TreeKeyDeps = {
    rows: ROWS,
    focusedPath,
    activePath: null,
    readOnly: false,
    setFocusedPath: vi.fn(),
    expand: vi.fn(),
    toggle: vi.fn(),
    open: vi.fn(),
    rename: vi.fn(),
    trash: vi.fn(),
    move: vi.fn(),
    create: vi.fn(),
    menu: vi.fn(),
    exit: vi.fn(),
    ...over,
  };
  return { d, act: treeActions(d) };
};

describe("treeActions", () => {
  it("j/k move and wrap; g/G jump; nothing focused starts at the ends", () => {
    let t = deps(null);
    t.act.down();
    expect(t.d.setFocusedPath).toHaveBeenLastCalledWith("a");
    t = deps(null);
    t.act.up();
    expect(t.d.setFocusedPath).toHaveBeenLastCalledWith("c.excalidraw");
    t = deps("c.excalidraw");
    t.act.down();
    expect(t.d.setFocusedPath).toHaveBeenLastCalledWith("a");
    t = deps("a");
    t.act.up();
    expect(t.d.setFocusedPath).toHaveBeenLastCalledWith("c.excalidraw");
    t.act.last();
    expect(t.d.setFocusedPath).toHaveBeenLastCalledWith("c.excalidraw");
    t.act.first();
    expect(t.d.setFocusedPath).toHaveBeenLastCalledWith("a");
  });

  it("starts from the open drawing when nothing is focused", () => {
    const t = deps(null, { activePath: "b" });
    t.act.down();
    expect(t.d.setFocusedPath).toHaveBeenLastCalledWith("c.excalidraw");
  });

  it("l expands a closed folder, steps into an open one, ignores drawings", () => {
    let t = deps("b");
    t.act.expand();
    expect(t.d.expand).toHaveBeenCalledWith("b");
    t = deps("a");
    t.act.expand();
    expect(t.d.setFocusedPath).toHaveBeenLastCalledWith("a/x.excalidraw");
    t = deps("c.excalidraw");
    t.act.expand();
    expect(t.d.expand).not.toHaveBeenCalled();
    expect(t.d.open).not.toHaveBeenCalled();
  });

  it("h closes an open folder, else goes to the parent", () => {
    let t = deps("a");
    t.act.collapse();
    expect(t.d.toggle).toHaveBeenCalledWith("a");
    t = deps("a/x.excalidraw");
    t.act.collapse();
    expect(t.d.setFocusedPath).toHaveBeenLastCalledWith("a");
    t = deps("c.excalidraw");
    t.act.collapse();
    expect(t.d.setFocusedPath).not.toHaveBeenCalled();
  });

  it("Enter opens drawings (new tab with Mod) and toggles folders", () => {
    let t = deps("c.excalidraw");
    t.act.open();
    expect(t.d.open).toHaveBeenCalledWith("c.excalidraw", false);
    t.act.openInNewTab();
    expect(t.d.open).toHaveBeenLastCalledWith("c.excalidraw", true);
    t = deps("b");
    t.act.open();
    expect(t.d.toggle).toHaveBeenCalledWith("b");
  });

  it("file actions target the focused row and respect read-only", () => {
    let t = deps("a/x.excalidraw");
    t.act.rename();
    t.act.delete();
    t.act.move();
    t.act.menu();
    expect(t.d.rename).toHaveBeenCalledWith(ROWS[1].entry);
    expect(t.d.trash).toHaveBeenCalledWith(ROWS[1].entry);
    expect(t.d.move).toHaveBeenCalledWith(ROWS[1].entry);
    expect(t.d.menu).toHaveBeenCalledWith(ROWS[1].entry);
    t = deps("a/x.excalidraw", { readOnly: true });
    t.act.rename();
    t.act.delete();
    t.act.newItem();
    expect(t.d.rename).not.toHaveBeenCalled();
    expect(t.d.trash).not.toHaveBeenCalled();
    expect(t.d.create).not.toHaveBeenCalled();
  });

  it("a/A create in the focused folder or beside the focused drawing", () => {
    let t = deps("a");
    t.act.newItem();
    expect(t.d.create).toHaveBeenCalledWith("a", "drawing");
    t = deps("a/x.excalidraw");
    t.act.newFolder();
    expect(t.d.create).toHaveBeenCalledWith("a", "folder");
    t = deps(null);
    t.act.newItem();
    expect(t.d.create).toHaveBeenCalledWith("", "drawing");
  });
});
