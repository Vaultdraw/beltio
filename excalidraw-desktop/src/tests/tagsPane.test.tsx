/** Tags pane upgrades: sort, persistence, virtualisation, keyboard, rename, dock chips. */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installListKeysForTests,
  pressListKey,
} from "../commands/listKeysForTests";

import { DrawingTags } from "../components/tags/TagChips";
import { TagsPanel, VIRTUALIZE_ABOVE } from "../components/tags/TagsPanel";
import { applyTagFilter, registerTagActions } from "../tags/tagActions";
import { tagStore } from "../tags/tagStore";

import type { TagCount } from "../tags/types";

const TAGS: TagCount[] = [
  { tag: "a", display: "a", count: 1 },
  { tag: "b", display: "b", count: 5 },
  { tag: "b/x", display: "b/x", count: 1 },
  { tag: "b/y", display: "b/y", count: 4 },
  { tag: "c", display: "c", count: 3 },
];

const many = (n: number): TagCount[] =>
  Array.from({ length: n }, (_, i) => {
    const k = `t${String(i).padStart(5, "0")}`;
    return { tag: k, display: k, count: (i % 9) + 1 };
  });

const labels = () =>
  screen
    .getAllByRole("treeitem")
    .map((r) => r.querySelector(".vault-tags__label")?.textContent);

function setup(extra: Partial<React.ComponentProps<typeof TagsPanel>> = {}) {
  const onQueryChange = vi.fn();
  const utils = render(
    <TagsPanel
      tags={TAGS}
      query=""
      onQueryChange={onQueryChange}
      vaultKey="/vault"
      {...extra}
    />,
  );
  return { onQueryChange, ...utils };
}

beforeEach(() => window.localStorage.clear());
let uninstall = () => {};
beforeEach(() => {
  uninstall = installListKeysForTests();
});
afterEach(() => {
  uninstall();
  cleanup();
});

describe("sort", () => {
  it("defaults to name and toggles to count at every level", () => {
    setup();
    expect(labels()).toEqual(["#a", "#b", "#x", "#y", "#c"]);
    fireEvent.click(screen.getByRole("button", { name: "Sort tags by count" }));
    expect(labels()).toEqual(["#b", "#y", "#x", "#c", "#a"]);
    expect(
      screen.getByRole("button", { name: "Sort tags by name" }),
    ).toHaveAttribute("title", expect.stringContaining("Sorted by count"));
  });

  it("starts from the defaultSort prop", () => {
    setup({ defaultSort: "count" });
    expect(labels()[0]).toBe("#b");
  });

  it("the saved per-vault choice beats the default and survives a remount", () => {
    const first = setup({ defaultSort: "count" });
    fireEvent.click(screen.getByRole("button", { name: "Sort tags by name" }));
    first.unmount();
    setup({ defaultSort: "count" });
    expect(labels()[0]).toBe("#a");
    cleanup();
    setup({ defaultSort: "count", vaultKey: "/other" });
    expect(labels()[0]).toBe("#b");
  });
});

describe("persisted state", () => {
  it("remembers collapsed nodes and the closed section per vault", () => {
    const first = setup();
    fireEvent.click(screen.getByRole("button", { name: "Collapse b" }));
    expect(labels()).toEqual(["#a", "#b", "#c"]);
    first.unmount();
    const second = setup();
    expect(labels()).toEqual(["#a", "#b", "#c"]);
    fireEvent.click(screen.getByRole("button", { name: "Tags" }));
    second.unmount();
    setup();
    expect(screen.queryAllByRole("treeitem")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Tags" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});

describe("virtualisation", () => {
  it("renders every row up to the threshold", () => {
    setup({ tags: many(VIRTUALIZE_ABOVE) });
    expect(screen.getAllByRole("treeitem")).toHaveLength(VIRTUALIZE_ABOVE);
  });

  it("renders only a window above it and follows the scroll", () => {
    setup({ tags: many(2000) });
    const rows = screen.getAllByRole("treeitem");
    expect(rows.length).toBeLessThan(100);
    expect(rows[0]).toHaveTextContent("#t00000");
    const list = screen.getByRole("tree");
    act(() => {
      list.scrollTop = 22 * 1000;
      fireEvent.scroll(list);
    });
    const after = screen.getAllByRole("treeitem");
    expect(after.length).toBeLessThan(100);
    expect(after.some((r) => r.textContent?.includes("#t01000"))).toBe(true);
    expect(after.some((r) => r.textContent?.includes("#t00000"))).toBe(false);
  });

  it("G jumps to the last row of a virtual list", () => {
    setup({ tags: many(2000) });
    const list = screen.getByRole("tree");
    list.focus();
    pressListKey(list, "G");
    expect(list.scrollTop).toBeGreaterThan(22 * 1900);
  });
});

describe("keyboard", () => {
  const key = (k: string) => pressListKey(screen.getByRole("tree"), k);
  const cursor = () =>
    screen
      .getAllByRole("treeitem")
      .find((r) => r.getAttribute("aria-selected") === "true")
      ?.querySelector(".vault-tags__label")?.textContent;

  it("moves with j/k/arrows and g/G", () => {
    setup();
    expect(cursor()).toBe("#a");
    key("j");
    expect(cursor()).toBe("#b");
    key("ArrowDown");
    expect(cursor()).toBe("#x");
    key("k");
    expect(cursor()).toBe("#b");
    key("G");
    expect(cursor()).toBe("#c");
    key("g");
    expect(cursor()).toBe("#a");
    key("ArrowUp");
    expect(cursor()).toBe("#a");
  });

  it("h collapses or goes to the parent, l expands or goes in", () => {
    setup();
    key("j");
    key("h");
    expect(labels()).toEqual(["#a", "#b", "#c"]);
    key("l");
    expect(labels()).toEqual(["#a", "#b", "#x", "#y", "#c"]);
    key("l");
    expect(cursor()).toBe("#x");
    key("h");
    expect(cursor()).toBe("#b");
  });

  it("Enter and Space apply the filter, then clear it", () => {
    const { onQueryChange, rerender } = setup();
    key("j");
    key("Enter");
    expect(onQueryChange).toHaveBeenLastCalledWith("tag:#b");
    rerender(
      <TagsPanel
        tags={TAGS}
        query="tag:#b"
        onQueryChange={onQueryChange}
        vaultKey="/vault"
      />,
    );
    key(" ");
    expect(onQueryChange).toHaveBeenLastCalledWith("");
  });

  it("r and F2 ask to rename the cursor tag; Escape exits", () => {
    const onRenameTag = vi.fn();
    const onExit = vi.fn();
    setup({ onRenameTag, onExit });
    key("j");
    key("j");
    key("r");
    expect(onRenameTag).toHaveBeenLastCalledWith("b/x", "b/x");
    key("F2");
    expect(onRenameTag).toHaveBeenCalledTimes(2);
    key("Escape");
    expect(onExit).toHaveBeenCalled();
  });

  it("ignores keys with modifiers", () => {
    setup();
    fireEvent.keyDown(screen.getByRole("tree"), { key: "j", metaKey: true });
    expect(cursor()).toBe("#a");
  });
});

describe("rename action", () => {
  it("has a row button only when onRenameTag is given", () => {
    const { unmount } = setup();
    expect(screen.queryByRole("button", { name: /Rename tag/ })).toBeNull();
    unmount();
    const onRenameTag = vi.fn();
    setup({ onRenameTag });
    fireEvent.click(screen.getByRole("button", { name: "Rename tag b/x…" }));
    expect(onRenameTag).toHaveBeenCalledWith("b/x", "b/x");
  });
});

describe("focus handle", () => {
  it("opens a closed section and focuses the list", () => {
    window.localStorage.setItem(
      "vaultdraw.tagsPane.v1",
      JSON.stringify({ "/vault": { open: false } }),
    );
    const ref = { current: null as { focus(): void } | null };
    setup({ ref });
    expect(screen.queryByRole("tree")).toBeNull();
    act(() => ref.current?.focus());
    expect(document.activeElement).toBe(screen.getByRole("tree"));
  });
});

describe("dock chips", () => {
  afterEach(() => tagStore.set([]));

  it("shows the drawing's tags from the store and applies a filter on click", () => {
    const filter = vi.fn();
    const off = registerTagActions({ filter, focusPane: vi.fn() });
    tagStore.set(TAGS, { "Notes.excalidraw": ["DSA/Graphs", "misc"] });
    render(<DrawingTags path="Notes.excalidraw" />);
    const box = within(screen.getByLabelText("Drawing tags"));
    fireEvent.click(
      box.getByRole("button", { name: "Filter by tag DSA/Graphs" }),
    );
    expect(filter).toHaveBeenCalledWith("dsa/graphs");
    off();
    expect(() => applyTagFilter("x")).not.toThrow();
  });

  it("renders nothing for an untagged drawing and follows the store", () => {
    render(<DrawingTags path="Notes.excalidraw" />);
    expect(screen.queryByLabelText("Drawing tags")).toBeNull();
    act(() => tagStore.set(TAGS, { "Notes.excalidraw": ["misc"] }));
    expect(screen.getByLabelText("Drawing tags")).toBeTruthy();
  });
});
