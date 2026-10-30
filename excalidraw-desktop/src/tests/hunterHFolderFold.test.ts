import { describe, expect, it } from "vitest";

import { moveRows } from "../components/moveTree";
import { searchEntries } from "../vault/treeStore";

import type { VaultEntry } from "../vault/types";

/**
 * Hunter H-5 (2026-10-30). Folder names are matched with `toLowerCase().includes()` only: the
 * sidebar search (`searchEntries`, folders always come from it) and the Move dialog type-ahead
 * (`moveTree.ts nameMatches`). Drawings in the same search fold accents natively, so "cafe"
 * finds the drawing "Cafe plans" and "Café plans" but not the folder "Café".
 */
const folder = (name: string): VaultEntry => ({
  path: name,
  name,
  kind: "folder",
  modifiedAt: 0,
  size: 0,
});

describe("hunter H-5: folder name matching folds accents", () => {
  it("case is folded (sanity)", () => {
    expect(searchEntries([folder("Café")], "CAFÉ")).toHaveLength(1);
  });

  it.fails("sidebar search: cafe finds the folder Café", () => {
    expect(searchEntries([folder("Café")], "cafe")).toHaveLength(1);
  });

  it.fails("Move dialog type-ahead: cafe finds the folder Café", () => {
    const rows = moveRows(["Café", "Other"], new Set(), "cafe");
    expect(rows.some((r) => r.entry.path === "Café" && r.matches)).toBe(true);
  });
});

describe("hunter H-5b: the Move dialog orders folders like the navigator (numeric)", () => {
  it.fails("Week 2 comes before Week 10", () => {
    const rows = moveRows(["Week 10", "Week 2"], new Set([""]), "");
    expect(rows.map((r) => r.entry.path)).toEqual(["", "Week 2", "Week 10"]);
  });
});
