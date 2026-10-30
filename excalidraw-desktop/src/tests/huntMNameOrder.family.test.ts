import { describe, expect, it } from "vitest";

import { buildTagTree } from "../tags/tagTree";
import { listTemplates } from "../templates/listTemplates";
import { sortEntries } from "../vault/sortOrder";

import type { VaultEntry } from "../vault/types";

/**
 * Hunter M (2026-10-30 night), toimprove M-11. Widens the family "a list of the vault's folders
 * orders them like the file tree" (moveDialogOrder.family.test.ts, toimprove 201) to every list
 * of names the user picks from: the file tree sorts naturally ("Meeting 2" before "Meeting 10",
 * as Obsidian's file explorer and Zed's project panel do), but the template picker
 * (`listTemplates.ts byName`) and the tags panel (`tagTree.ts byName`) use a plain
 * `localeCompare`, so "Meeting 10" comes before "Meeting 2" and "#sprint/10" before "#sprint/2".
 */
const NAMES = ["Meeting 10", "Meeting 2", "Meeting 1", "Archive"];

const treeOrder = (names: string[]) =>
  sortEntries(
    names.map(
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

describe("family: every list of names follows the tree's order (toimprove M-11)", () => {
  it("(context) the tree puts Meeting 2 before Meeting 10", () => {
    const order = treeOrder(NAMES);
    expect(order.indexOf("Meeting 2")).toBeLessThan(
      order.indexOf("Meeting 10"),
    );
  });

  it("the template picker lists vault and global templates in the tree's order", async () => {
    const entry = (name: string) => ({
      path: `Templates/${name}.excalidraw`,
      name: `${name}.excalidraw`,
      kind: "drawing" as const,
      modifiedAt: 0,
      size: 0,
    });
    const r = await listTemplates({
      repository: {
        listDirectory: async () => NAMES.map(entry),
      } as never,
      handle: "h",
      folder: "Templates",
      global: {
        list: async () =>
          NAMES.map((n) => ({
            name: `${n}.excalidraw`,
            modifiedAt: 0,
            size: 0,
          })),
      } as never,
    });
    expect(r.vault.map((t) => t.name)).toEqual(treeOrder(NAMES));
    expect(r.global.map((t) => t.name)).toEqual(treeOrder(NAMES));
  });

  it("the tags panel orders child tags in the tree's order", () => {
    const kids = ["10", "2", "1"];
    const tree = buildTagTree(
      [
        { tag: "sprint", display: "sprint", count: 3 },
        ...kids.map((k) => ({
          tag: `sprint/${k}`,
          display: `sprint/${k}`,
          count: 1,
        })),
      ],
      "name",
    );
    expect(tree[0].children.map((n) => n.label)).toEqual(treeOrder(kids));
  });
});
