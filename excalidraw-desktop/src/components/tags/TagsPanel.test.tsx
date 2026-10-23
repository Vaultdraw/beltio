import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installListKeysForTests,
  pressListKey,
} from "../../commands/listKeysForTests";

import { TagsPanel, VIRTUALIZE_ABOVE, windowRange } from "./TagsPanel";

const tags = [
  { tag: "dsa", display: "dsa", count: 2 },
  { tag: "dsa/a", display: "dsa/a", count: 1 },
  { tag: "dsa/b", display: "dsa/b", count: 2 },
  { tag: "x", display: "x", count: 5 },
];

const labels = () =>
  screen
    .getAllByRole("treeitem")
    .map((el) => el.querySelector(".vault-tags__label")!.textContent);

beforeEach(() => window.localStorage.clear());
let uninstall = () => {};
beforeEach(() => {
  uninstall = installListKeysForTests();
});
afterEach(() => {
  uninstall();
  cleanup();
});

describe("TagsPanel", () => {
  it("renders nothing without tags", () => {
    const { container } = render(
      <TagsPanel tags={[]} query="" onQueryChange={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("sorts siblings at every level and remembers the choice per vault", () => {
    const r = render(
      <TagsPanel tags={tags} query="" onQueryChange={() => {}} vaultKey="v1" />,
    );
    expect(labels()).toEqual(["#dsa", "#a", "#b", "#x"]);
    fireEvent.click(screen.getByRole("button", { name: "Sort tags by count" }));
    expect(labels()).toEqual(["#x", "#dsa", "#b", "#a"]);
    r.unmount();
    render(
      <TagsPanel tags={tags} query="" onQueryChange={() => {}} vaultKey="v1" />,
    );
    expect(labels()).toEqual(["#x", "#dsa", "#b", "#a"]);
    cleanup();
    render(
      <TagsPanel tags={tags} query="" onQueryChange={() => {}} vaultKey="v2" />,
    );
    expect(labels()).toEqual(["#dsa", "#a", "#b", "#x"]);
  });

  it("keyboard: j/k/h/l/G/g move, Enter toggles the filter, Escape exits", () => {
    const onQueryChange = vi.fn();
    const onExit = vi.fn();
    render(
      <TagsPanel
        tags={tags}
        query=""
        onQueryChange={onQueryChange}
        onExit={onExit}
      />,
    );
    const list = screen.getByRole("tree", { name: "Tag list" });
    const key = (k: string) => pressListKey(list, k);
    const cursor = () =>
      list.querySelector(".vault-tags__row--cursor .vault-tags__label")!
        .textContent;
    expect(cursor()).toBe("#dsa");
    key("j");
    expect(cursor()).toBe("#a");
    key("h");
    expect(cursor()).toBe("#dsa");
    key("h");
    expect(labels()).toEqual(["#dsa", "#x"]);
    key("l");
    expect(labels()).toHaveLength(4);
    key("G");
    expect(cursor()).toBe("#x");
    key("Enter");
    expect(onQueryChange).toHaveBeenLastCalledWith("tag:#x");
    key("g");
    key("k");
    expect(cursor()).toBe("#dsa");
    key("Escape");
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("Enter on the active tag clears the filter", () => {
    const onQueryChange = vi.fn();
    render(
      <TagsPanel tags={tags} query="tag:#dsa" onQueryChange={onQueryChange} />,
    );
    pressListKey(screen.getByRole("tree", { name: "Tag list" }), "Enter");
    expect(onQueryChange).toHaveBeenCalledWith("");
  });

  it("windows rows above the threshold", () => {
    const many = Array.from({ length: VIRTUALIZE_ABOVE + 200 }, (_, i) => ({
      tag: `t${String(i).padStart(4, "0")}`,
      display: `t${String(i).padStart(4, "0")}`,
      count: 1,
    }));
    render(<TagsPanel tags={many} query="" onQueryChange={() => {}} />);
    expect(screen.getAllByRole("treeitem").length).toBeLessThan(60);
  });
});

describe("windowRange", () => {
  it("is the full range at or below the threshold", () => {
    expect(windowRange(VIRTUALIZE_ABOVE, 0, 300)).toEqual([
      0,
      VIRTUALIZE_ABOVE,
    ]);
  });
  it("clamps to the total at the end", () => {
    const total = VIRTUALIZE_ABOVE + 100;
    const [from, to] = windowRange(total, 1e9, 300);
    expect(to).toBe(total);
    expect(from).toBeLessThanOrEqual(total);
  });
});
