import { describe, expect, it } from "vitest";

import { listNotePaths } from "./noteScan";

import type { VaultEntry } from "../vault/types";

const e = (path: string, kind: VaultEntry["kind"]): VaultEntry => ({
  path,
  name: path.split("/").pop()!,
  kind,
  modifiedAt: 0,
  size: 0,
});

describe("listNotePaths", () => {
  it("finds notes in every folder and skips the rest", async () => {
    const tree: Record<string, VaultEntry[]> = {
      "": [e("A.md", "note"), e("D", "folder"), e("x.excalidraw", "drawing")],
      D: [
        e("D/B.md", "note"),
        e("D/E", "folder"),
        e("D/p.excalidraw.md", "excalidrawMd"),
      ],
      "D/E": [e("D/E/C.md", "note")],
    };
    const repo = {
      listDirectory: async (_h: string, dir: string) => tree[dir] ?? [],
    };
    expect(await listNotePaths(repo, "h")).toEqual([
      "A.md",
      "D/B.md",
      "D/E/C.md",
    ]);
  });

  it("skips a folder that cannot be listed", async () => {
    const repo = {
      listDirectory: async (_h: string, dir: string) => {
        if (dir === "") {
          return [e("Bad", "folder"), e("A.md", "note")];
        }
        throw new Error("gone");
      },
    };
    expect(await listNotePaths(repo, "h")).toEqual(["A.md"]);
  });
});
