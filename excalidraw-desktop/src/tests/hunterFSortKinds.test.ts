import { describe, expect, it } from "vitest";

import { compareEntries, SORT_ORDERS } from "../vault/sortOrder";
import { buildTree } from "../vault/treeStore";

import type { VaultEntry } from "../vault/types";

/**
 * Hunter F-6 (2026-10-30). `compareEntries` (vault/sortOrder.ts) puts folders first with
 * `if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1`. Since notes (kind "note") and
 * Obsidian drawings ("excalidrawMd") joined the tree, two FILES of different kinds also take that
 * branch: the answer is 1 both ways (a comparator that says a > b and b > a), so a folder holding
 * drawings and notes is not ordered by name or by date at all. Obsidian orders every file together
 * (folders first), whatever its type.
 */
const e = (
  name: string,
  kind: VaultEntry["kind"],
  modifiedAt = 0,
): VaultEntry => ({
  path: name,
  name,
  kind,
  modifiedAt,
  size: 0,
});

describe("hunter F-6: files of different kinds sort together", () => {
  it("a drawing and a note are ordered both ways (antisymmetry)", () => {
    const a = e("a.excalidraw", "drawing");
    const b = e("b.md", "note");
    expect(Math.sign(compareEntries(a, b, "name_asc"))).toBe(-1);
    expect(Math.sign(compareEntries(b, a, "name_asc"))).toBe(1);
  });

  it("the navigator lists a mixed folder A to Z", () => {
    // a new note is appended after the listing's order until the next refresh
    const entries = [
      e("a.excalidraw", "drawing", 1),
      e("c.excalidraw", "drawing", 3),
      e("e.excalidraw.md", "excalidrawMd", 5),
      e("d.md", "note", 4),
      e("b.md", "note", 2),
    ];
    const tree = buildTree(new Map([["", entries]]), "", "name_asc");
    expect(tree.map((n) => n.entry.name)).toEqual([
      "a.excalidraw",
      "b.md",
      "c.excalidraw",
      "d.md",
      "e.excalidraw.md",
    ]);
  });

  it("the other three orders also keep a mixed folder in order", () => {
    const entries = [
      e("a.excalidraw", "drawing", 1),
      e("b.md", "note", 2),
      e("c.excalidraw", "drawing", 3),
      e("d.md", "note", 4),
    ];
    const want: Record<string, string[]> = {
      name_desc: ["d.md", "c.excalidraw", "b.md", "a.excalidraw"],
      modified_desc: ["d.md", "c.excalidraw", "b.md", "a.excalidraw"],
      modified_asc: ["a.excalidraw", "b.md", "c.excalidraw", "d.md"],
    };
    for (const order of SORT_ORDERS.filter((o) => o !== "name_asc")) {
      const tree = buildTree(new Map([["", entries]]), "", order);
      expect(
        tree.map((n) => n.entry.name),
        order,
      ).toEqual(want[order]);
    }
  });
});
