import { describe, expect, it } from "vitest";

import { joinGroups, typeAheadIndex, type MenuNode } from "./menuModel";

const noop = () => {};
const item = (id: string): MenuNode => ({
  kind: "item",
  id,
  label: id,
  run: noop,
});

describe("joinGroups", () => {
  it("puts one divider between non-empty groups only", () => {
    const out = joinGroups([[item("a")], [], [item("b"), item("c")], []]);
    expect(
      out.map((n) => (n.kind === "separator" ? "-" : (n as any).id)),
    ).toEqual(["a", "-", "b", "c"]);
  });

  it("never leads or trails with a divider", () => {
    expect(joinGroups([[], [item("a")], []])).toEqual([item("a")]);
    expect(joinGroups([])).toEqual([]);
  });

  it("drops a submenu with no items", () => {
    const empty: MenuNode = { kind: "submenu", id: "s", label: "S", items: [] };
    expect(joinGroups([[empty], [item("a")]])).toEqual([item("a")]);
  });
});

describe("typeAheadIndex", () => {
  const labels = ["New drawing", "New folder", "Duplicate", "Move to…"];
  it("finds the next match after the current item, wrapping", () => {
    expect(typeAheadIndex(labels, 0, "d")).toBe(2);
    expect(typeAheadIndex(labels, 2, "d")).toBe(2);
    expect(typeAheadIndex(labels, 3, "n")).toBe(0);
  });
  it("a longer prefix may stay on the current item", () => {
    expect(typeAheadIndex(labels, 0, "new f")).toBe(1);
    expect(typeAheadIndex(labels, 1, "new")).toBe(1);
  });
  it("cycles on a repeated letter and returns -1 when nothing matches", () => {
    expect(typeAheadIndex(labels, 0, "nn")).toBe(1);
    expect(typeAheadIndex(labels, 0, "z")).toBe(-1);
    expect(typeAheadIndex([], 0, "a")).toBe(-1);
  });
});
