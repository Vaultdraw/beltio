import { describe, expect, it } from "vitest";

import { ACTIVITY_ENTRIES } from "./entries";
import {
  hasShownActivityEntry,
  moveActivityEntry,
  resolveActivityLayout,
  setActivityEntryHidden,
} from "./layout";

const ids = (rows: { entry: { id: string } }[]) => rows.map((r) => r.entry.id);
const DEFAULT = ACTIVITY_ENTRIES.map((e) => e.id);

describe("resolveActivityLayout", () => {
  it("keeps the default order and shows everything with no settings", () => {
    const rows = resolveActivityLayout(ACTIVITY_ENTRIES, [], []);
    expect(ids(rows)).toEqual(DEFAULT);
    expect(rows.some((r) => r.hidden)).toBe(false);
  });

  it("applies the listed order and appends missing ids in default order", () => {
    const rows = resolveActivityLayout(
      ACTIVITY_ENTRIES,
      ["tags", "library"],
      [],
    );
    expect(ids(rows).slice(0, 2)).toEqual(["tags", "library"]);
    expect(ids(rows).slice(2)).toEqual(
      DEFAULT.filter((id) => id !== "tags" && id !== "library"),
    );
  });

  it("ignores unknown and duplicate ids", () => {
    const rows = resolveActivityLayout(
      ACTIVITY_ENTRIES,
      ["nope", "graph", "graph"],
      ["gone"],
    );
    expect(ids(rows)).toHaveLength(DEFAULT.length);
    expect(ids(rows)[0]).toBe("graph");
    expect(rows.some((r) => r.hidden)).toBe(false);
  });

  it("flags hidden entries", () => {
    const rows = resolveActivityLayout(ACTIVITY_ENTRIES, [], ["tags"]);
    expect(rows.filter((r) => r.hidden).map((r) => r.entry.id)).toEqual([
      "tags",
    ]);
  });
});

describe("moveActivityEntry", () => {
  it("moves within the group and returns the full order", () => {
    const next = moveActivityEntry(ACTIVITY_ENTRIES, [], "graph", -1);
    expect(next.indexOf("graph")).toBe(DEFAULT.indexOf("graph") - 1);
    expect(next).toHaveLength(DEFAULT.length);
  });

  it("does nothing at the ends of a group", () => {
    expect(moveActivityEntry(ACTIVITY_ENTRIES, [], "library", -1)).toEqual(
      DEFAULT,
    );
    expect(moveActivityEntry(ACTIVITY_ENTRIES, [], "templates", 1)).toEqual(
      DEFAULT,
    );
    expect(moveActivityEntry(ACTIVITY_ENTRIES, [], "settings", 1)).toEqual(
      DEFAULT,
    );
  });

  it("never crosses into the other group", () => {
    const next = moveActivityEntry(ACTIVITY_ENTRIES, [], "hotkeys", -1);
    expect(next).toEqual(DEFAULT);
  });

  it("ignores an unknown id", () => {
    expect(moveActivityEntry(ACTIVITY_ENTRIES, [], "x", 1)).toEqual(DEFAULT);
  });
});

describe("setActivityEntryHidden", () => {
  it("adds once, removes, and drops unknown ids", () => {
    let hidden = setActivityEntryHidden(
      ACTIVITY_ENTRIES,
      ["old"],
      "tags",
      true,
    );
    expect(hidden).toEqual(["tags"]);
    hidden = setActivityEntryHidden(ACTIVITY_ENTRIES, hidden, "tags", true);
    expect(hidden).toEqual(["tags"]);
    expect(
      setActivityEntryHidden(ACTIVITY_ENTRIES, hidden, "tags", false),
    ).toEqual([]);
  });
});

describe("hasShownActivityEntry", () => {
  const all = DEFAULT;
  it("is true unless the hidden list covers every entry", () => {
    expect(hasShownActivityEntry(ACTIVITY_ENTRIES, [])).toBe(true);
    expect(hasShownActivityEntry(ACTIVITY_ENTRIES, all.slice(1))).toBe(true);
    expect(hasShownActivityEntry(ACTIVITY_ENTRIES, all)).toBe(false);
    expect(hasShownActivityEntry(ACTIVITY_ENTRIES, [...all, "unknown"])).toBe(
      false,
    );
  });
  it("ignores unknown hidden ids and keeps an empty registry showing", () => {
    expect(hasShownActivityEntry(ACTIVITY_ENTRIES, ["nope"])).toBe(true);
    expect(hasShownActivityEntry([], [])).toBe(true);
  });
});
