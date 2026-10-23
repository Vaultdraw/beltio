import { describe, expect, it, vi } from "vitest";

import {
  lazyTreeController,
  targetFolder,
  treeActions,
  type TreeAction,
  type TreeKeyDeps,
} from "./treeKeys";

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
    dragging: false,
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
  const actions = treeActions(d);
  const run = (action: TreeAction) => {
    const fn = actions[action];
    expect(fn, `${action} offered`).toBeDefined();
    fn!();
  };
  return { d, actions, run };
};

describe("treeActions", () => {
  it("j/k move and wrap; g/G jump; nothing focused starts at the ends", () => {
    let t = deps(null);
    t.run("down");
    expect(t.d.setFocusedPath).toHaveBeenLastCalledWith("a");
    t = deps(null);
    t.run("up");
    expect(t.d.setFocusedPath).toHaveBeenLastCalledWith("c.excalidraw");
    t = deps("c.excalidraw");
    t.run("down");
    expect(t.d.setFocusedPath).toHaveBeenLastCalledWith("a");
    t = deps("a");
    t.run("up");
    expect(t.d.setFocusedPath).toHaveBeenLastCalledWith("c.excalidraw");
    t.run("last");
    expect(t.d.setFocusedPath).toHaveBeenLastCalledWith("c.excalidraw");
    t.run("first");
    expect(t.d.setFocusedPath).toHaveBeenLastCalledWith("a");
  });

  it("navigation starts from the open drawing when nothing is focused", () => {
    const t = deps(null, { activePath: "b" });
    t.run("down");
    expect(t.d.setFocusedPath).toHaveBeenLastCalledWith("c.excalidraw");
  });

  it("l expands a closed folder, steps into an open one, ignores drawings", () => {
    let t = deps("b");
    t.run("expand");
    expect(t.d.expand).toHaveBeenCalledWith("b");
    t = deps("a");
    t.run("expand");
    expect(t.d.setFocusedPath).toHaveBeenLastCalledWith("a/x.excalidraw");
    t = deps("c.excalidraw");
    t.run("expand");
    expect(t.d.expand).not.toHaveBeenCalled();
    expect(t.d.open).not.toHaveBeenCalled();
  });

  it("h closes an open folder, else goes to the parent", () => {
    let t = deps("a");
    t.run("collapse");
    expect(t.d.toggle).toHaveBeenCalledWith("a");
    t = deps("a/x.excalidraw");
    t.run("collapse");
    expect(t.d.setFocusedPath).toHaveBeenLastCalledWith("a");
    t = deps("c.excalidraw");
    t.run("collapse");
    expect(t.d.setFocusedPath).not.toHaveBeenCalled();
  });

  it("Enter opens drawings (new tab with Mod) and toggles folders", () => {
    let t = deps("c.excalidraw");
    t.run("open");
    expect(t.d.open).toHaveBeenCalledWith("c.excalidraw", false);
    t.run("openInNewTab");
    expect(t.d.open).toHaveBeenLastCalledWith("c.excalidraw", true);
    t = deps("b");
    t.run("select");
    expect(t.d.toggle).toHaveBeenCalledWith("b");
  });

  it("Enter with no focused row only moves the cursor to the open drawing", () => {
    const t = deps(null, { activePath: "c.excalidraw" });
    t.run("open");
    expect(t.d.open).not.toHaveBeenCalled();
    expect(t.d.setFocusedPath).toHaveBeenLastCalledWith("c.excalidraw");
  });

  it("file actions target the focused row", () => {
    const t = deps("a/x.excalidraw");
    t.run("rename");
    t.run("delete");
    t.run("move");
    t.run("menu");
    expect(t.d.rename).toHaveBeenCalledWith(ROWS[1].entry);
    expect(t.d.trash).toHaveBeenCalledWith(ROWS[1].entry);
    expect(t.d.move).toHaveBeenCalledWith(ROWS[1].entry);
    expect(t.d.menu).toHaveBeenCalledWith(ROWS[1].entry);
  });

  // Regression: d/Backspace used to trash the open drawing when no row had
  // focus (the cursor fell back to activePath).
  it("with no focused row, edits are not offered even with a drawing open", () => {
    const t = deps(null, { activePath: "c.excalidraw" });
    for (const action of ["rename", "delete", "move", "menu"] as const) {
      expect(t.actions[action], action).toBeUndefined();
    }
    const stale = deps("gone.excalidraw", { activePath: "c.excalidraw" });
    expect(stale.actions.delete).toBeUndefined();
  });

  it("read-only vaults offer no edits; a drag keeps Escape", () => {
    const t = deps("a/x.excalidraw", { readOnly: true });
    for (const action of [
      "rename",
      "delete",
      "move",
      "newItem",
      "newFolder",
    ] as const) {
      expect(t.actions[action], action).toBeUndefined();
    }
    expect(deps("a", { dragging: true }).actions.exit).toBeUndefined();
  });

  it("a/A create in the focused folder or beside the focused drawing", () => {
    let t = deps("a");
    t.run("newItem");
    expect(t.d.create).toHaveBeenCalledWith("a", "drawing");
    t = deps("a/x.excalidraw");
    t.run("newFolder");
    expect(t.d.create).toHaveBeenCalledWith("a", "folder");
    t = deps(null);
    t.run("newItem");
    expect(t.d.create).toHaveBeenCalledWith("", "drawing");
  });
});

describe("targetFolder", () => {
  const isFolder = (p: string) => p === "a" || p === "a/b";
  it("is the folder itself, a drawing's parent, or the root", () => {
    expect(targetFolder("a/b", isFolder)).toBe("a/b");
    expect(targetFolder("a/b/x.excalidraw", isFolder)).toBe("a/b");
    expect(targetFolder("x.excalidraw", isFolder)).toBe("");
    expect(targetFolder(null, isFolder)).toBe("");
  });
});

describe("lazyTreeController", () => {
  it("computes nothing until asked and reads the latest snapshot", () => {
    const ref: { current: TreeKeyDeps | null } = { current: null };
    const c = lazyTreeController(ref);
    expect(c.down).toBeUndefined();
    const { d } = deps("a");
    ref.current = d;
    c.down!();
    expect(d.setFocusedPath).toHaveBeenLastCalledWith("a/x.excalidraw");
    expect(c.delete).toBeDefined();
    ref.current = { ...d, focusedPath: null };
    expect(c.delete).toBeUndefined();
  });
});
