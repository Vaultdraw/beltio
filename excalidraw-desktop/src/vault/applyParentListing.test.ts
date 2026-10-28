import { describe, expect, it } from "vitest";

import { applyParentListing } from "./applyParentListing";

import type { VaultEntry } from "./types";

/** Outside changes family (bug hunt BH-3): the flat index after one folder is re-read. */
const e = (path: string, kind: "folder" | "drawing" = "drawing") =>
  ({ path, kind, name: path.split("/").pop() } as unknown as VaultEntry);
const paths = (list: VaultEntry[]) => list.map((x) => x.path).sort();
const base = [
  e("A", "folder"),
  e("A/x.excalidraw"),
  e("A/B", "folder"),
  e("A/B/y.excalidraw"),
  e("A/B/C", "folder"),
  e("A/B/C/z.excalidraw"),
  e("top.excalidraw"),
];

describe("applyParentListing", () => {
  it.each([
    [
      "a folder deleted outside: its listing is gone",
      "A/B",
      null,
      ["A", "A/x.excalidraw", "top.excalidraw"],
    ],
    [
      "the root lost a folder: everything under it goes",
      "",
      [e("top.excalidraw")],
      ["top.excalidraw"],
    ],
    [
      "a new file appears",
      "A",
      [e("A/x.excalidraw"), e("A/B", "folder"), e("A/new.excalidraw")],
      [...paths(base), "A/new.excalidraw"].sort(),
    ],
    [
      "a file deleted",
      "A",
      [e("A/B", "folder")],
      paths(base).filter((p) => p !== "A/x.excalidraw"),
    ],
    [
      "a folder renamed: old subtree goes, new name listed",
      "A",
      [e("A/x.excalidraw"), e("A/B2", "folder")],
      ["A", "A/B2", "A/x.excalidraw", "top.excalidraw"],
    ],
    ["a gone folder nobody indexed: nothing changes", "Q/R", null, paths(base)],
  ] as const)("%s", (_n, parent, entries, expected) => {
    expect(
      paths(applyParentListing(base, parent, entries as VaultEntry[] | null)),
    ).toEqual(expected);
  });
});
