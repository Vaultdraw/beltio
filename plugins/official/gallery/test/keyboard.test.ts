import { describe, expect, it } from "vitest";

import { moveIndex, type KeyContext } from "../src/keyboard";

const c = (over: Partial<KeyContext> = {}): KeyContext => ({
  index: 5,
  count: 10,
  columns: 4,
  pageRows: 2,
  ...over,
});

describe("gallery moves", () => {
  it("moves one tile or one row", () => {
    expect(moveIndex("left", c())).toBe(4);
    expect(moveIndex("right", c())).toBe(6);
    expect(moveIndex("up", c())).toBe(1);
    expect(moveIndex("down", c())).toBe(9);
  });

  it("clamps at the edges", () => {
    expect(moveIndex("left", c({ index: 0 }))).toBe(0);
    expect(moveIndex("right", c({ index: 9 }))).toBe(9);
    expect(moveIndex("up", c({ index: 2 }))).toBe(2);
    expect(moveIndex("down", c({ index: 9 }))).toBe(9);
    // short last row: down from row 1 lands on the last tile
    expect(moveIndex("down", c({ index: 7 }))).toBe(9);
    expect(moveIndex("down", c({ index: 8 }))).toBe(8);
  });

  it("first, last and paging", () => {
    expect(moveIndex("first", c())).toBe(0);
    expect(moveIndex("last", c())).toBe(9);
    expect(moveIndex("pageDown", c({ index: 1 }))).toBe(9);
    expect(moveIndex("pageDown", c({ index: 5 }))).toBe(9);
    expect(moveIndex("pageUp", c({ index: 9 }))).toBe(1);
    expect(moveIndex("pageUp", c({ index: 6 }))).toBe(2);
  });

  it("does nothing for no items", () => {
    expect(moveIndex("right", c({ count: 0 }))).toBeNull();
  });
});
