import { describe, expect, it, vi } from "vitest";

import { createSlotRegistry } from "./slotRegistry";

type Item = { id: string };
const make = () => createSlotRegistry<Item, "a" | "b">(["a", "b"]);

describe("slotRegistry", () => {
  it("lists in registration order and removes on dispose", () => {
    const r = make();
    const d1 = r.register("a", [{ id: "1" }, { id: "2" }]);
    r.register("a", [{ id: "3" }]);
    expect(r.list("a").map((x) => x.id)).toEqual(["1", "2", "3"]);
    d1();
    expect(r.list("a").map((x) => x.id)).toEqual(["3"]);
    expect(r.list("b")).toEqual([]);
  });

  it("refuses duplicate ids (first wins) and frees them on dispose", () => {
    const r = make();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = { id: "x" };
    const d = r.register("a", [first]);
    r.register("b", [{ id: "x" }]);
    expect(r.list("b")).toEqual([]);
    expect(r.list("a")[0]).toBe(first);
    expect(warn).toHaveBeenCalled();
    d();
    r.register("b", [{ id: "x" }]);
    expect(r.list("b")).toHaveLength(1);
    warn.mockRestore();
  });

  it("keeps the snapshot reference until a change", () => {
    const r = make();
    r.register("a", [{ id: "1" }]);
    const s = r.list("a");
    expect(r.list("a")).toBe(s);
    r.register("b", [{ id: "2" }]);
    expect(r.list("a")).toBe(s);
    r.register("a", [{ id: "3" }]);
    expect(r.list("a")).not.toBe(s);
  });

  it("notifies once per register and dispose, and disposes once", () => {
    const r = make();
    const l = vi.fn();
    const off = r.subscribe(l);
    const v = r.version();
    const d = r.register("a", [{ id: "1" }, { id: "2" }]);
    expect(l).toHaveBeenCalledTimes(1);
    d();
    d();
    expect(l).toHaveBeenCalledTimes(2);
    expect(r.version()).toBe(v + 2);
    off();
    r.register("a", [{ id: "9" }]);
    expect(l).toHaveBeenCalledTimes(2);
  });
});
