import { describe, expect, it } from "vitest";

import { buildFolderTree } from "../components/moveTree";
import { sortEntries } from "../vault/sortOrder";

import type { VaultEntry } from "../vault/types";

/**
 * Family (validator, 2026-10-30, from hunter H-5's note): a list of the vault's folders orders
 * them as the file tree does (natural order: "Week 2" before "Week 10", like Obsidian's file
 * explorer). The Move dialog (`moveTree.ts buildFolderTree`) sorts paths with a plain
 * `localeCompare`, so "Week 10" comes before "Week 2" there while the tree shows the opposite.
 */
const NAMES = ["Week 10", "Week 2", "Week 1", "Archive", "café", "Cafe 2"];

const treeOrder = () =>
  sortEntries(
    NAMES.map(
      (name): VaultEntry => ({
        path: name,
        name,
        kind: "folder",
        modifiedAt: 0,
        size: 0,
      }),
    ),
    "name_asc",
  ).map((e) => e.name);

describe("family: folder lists follow the tree's order", () => {
  it("(context) the tree puts Week 2 before Week 10", () => {
    const order = treeOrder();
    expect(order.indexOf("Week 2")).toBeLessThan(order.indexOf("Week 10"));
  });

  it.fails(
    "the Move dialog lists top-level folders in the tree's order",
    () => {
      const [root] = buildFolderTree(NAMES);
      expect(root.children!.map((n) => n.entry.name)).toEqual(treeOrder());
    },
  );

  it.fails("the Move dialog orders subfolders the same way", () => {
    const [root] = buildFolderTree(NAMES.map((n) => `Year/${n}`));
    const year = root.children![0];
    expect(year.children!.map((n) => n.entry.name)).toEqual(treeOrder());
  });
});
