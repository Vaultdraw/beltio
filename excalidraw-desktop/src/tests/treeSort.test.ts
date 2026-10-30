import { describe, expect, it } from "vitest";

import { SORT_ORDERS, type SortOrder } from "../vault/sortOrder";
import { buildTree } from "../vault/treeStore";

import type { VaultEntry } from "../vault/types";

const entry = (
  path: string,
  kind: VaultEntry["kind"],
  modifiedAt = 0,
): VaultEntry => ({
  path,
  name: path.split("/").pop()!,
  kind,
  modifiedAt,
  size: 0,
});

const names = (nodes: { entry: VaultEntry }[]) =>
  nodes.map((n) => n.entry.name);

describe("buildTree sorting", () => {
  const map = new Map<string, VaultEntry[]>([
    [
      "",
      [
        entry("b.excalidraw", "drawing", 5),
        entry("Zed", "folder", 1),
        entry("Drawing 10.excalidraw", "drawing", 5),
        entry("Drawing 2.excalidraw", "drawing", 9),
        entry("alpha", "folder", 2),
      ],
    ],
    ["Zed", [entry("Zed/y", "drawing", 1), entry("Zed/x", "drawing", 2)]],
  ]);

  it("defaults to name ascending, folders first, numeric", () => {
    const tree = buildTree(map);
    expect(names(tree)).toEqual([
      "alpha",
      "Zed",
      "b.excalidraw",
      "Drawing 2.excalidraw",
      "Drawing 10.excalidraw",
    ]);
  });

  it("sorts nested directories with the same order", () => {
    const tree = buildTree(map, "", "name_desc");
    expect(names(tree).slice(0, 2)).toEqual(["Zed", "alpha"]);
    expect(names(tree.find((n) => n.entry.name === "Zed")!.children!)).toEqual([
      "y",
      "x",
    ]);
  });

  it("modified order breaks ties by name", () => {
    expect(names(buildTree(map, "", "modified_desc")).slice(2)).toEqual([
      "Drawing 2.excalidraw",
      "b.excalidraw",
      "Drawing 10.excalidraw",
    ]);
    expect(names(buildTree(map, "", "modified_asc")).slice(2)).toEqual([
      "b.excalidraw",
      "Drawing 10.excalidraw",
      "Drawing 2.excalidraw",
    ]);
  });

  it("does not mutate the input", () => {
    const before = names(map.get("")!.map((entry) => ({ entry })));
    buildTree(map, "", "name_desc");
    expect(names(map.get("")!.map((entry) => ({ entry })))).toEqual(before);
  });
});

describe("buildTree order on 5,000 entries", () => {
  const big = new Map<string, VaultEntry[]>();
  const folders: VaultEntry[] = [];
  for (let f = 0; f < 50; f++) {
    const dir = `Folder ${f}`;
    folders.push(entry(dir, "folder", f));
    const drawings: VaultEntry[] = [];
    for (let d = 0; d < 99; d++) {
      drawings.push(entry(`${dir}/Drawing ${d}.excalidraw`, "drawing", d % 7));
    }
    big.set(dir, drawings);
  }
  big.set("", folders);

  it.each(SORT_ORDERS as readonly SortOrder[])("%s is ordered", (order) => {
    const tree = buildTree(big, "", order);
    expect(tree).toHaveLength(50);
    expect(tree.every((n) => n.entry.kind === "folder")).toBe(true);
    const first = tree[0].children!;
    expect(first).toHaveLength(99);
    if (order === "name_asc") {
      expect(names(tree)[1]).toBe("Folder 1");
      expect(names(first).slice(0, 3)).toEqual([
        "Drawing 0.excalidraw",
        "Drawing 1.excalidraw",
        "Drawing 2.excalidraw",
      ]);
    }
    if (order === "modified_desc") {
      expect(first[0].entry.modifiedAt).toBe(6);
      expect(names(first).slice(0, 2)).toEqual([
        "Drawing 6.excalidraw",
        "Drawing 13.excalidraw",
      ]);
    }
  });
});
