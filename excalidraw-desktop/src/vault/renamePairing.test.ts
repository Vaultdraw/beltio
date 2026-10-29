import { describe, expect, it } from "vitest";

import { findRenamed, renameCandidates } from "./renamePairing";

describe("pairing an outside rename (hunter C-4)", () => {
  it.each([
    [
      "file renamed",
      "a/x.excalidraw",
      ["a/x.excalidraw", "a/y.excalidraw"],
      ["a/y.excalidraw"],
    ],
    ["file moved", "a/x.md", ["a/x.md", "b/x.md"], ["b/x.md"]],
    [
      "folder renamed",
      "a/b/x.excalidraw",
      ["a", "a/b", "a/b/x.excalidraw", "c", "c/b", "c/b/x.excalidraw"],
      ["c/b/x.excalidraw"],
    ],
    [
      "other kinds ignored",
      "a/x.md",
      ["a/x.md", "a/x.excalidraw", "a/y.md"],
      ["a/y.md"],
    ],
  ])("%s", (_n, path, batch, expected) => {
    expect(renameCandidates(path, batch)).toEqual(
      expect.arrayContaining(expected),
    );
  });

  it("only the same revision counts", async () => {
    const revs: Record<string, string> = { "a/y.md": "r2", "a/z.md": "r1" };
    const at = async (p: string) => revs[p] ?? null;
    expect(
      await findRenamed("a/x.md", "r1", ["a/x.md", "a/y.md", "a/z.md"], at),
    ).toBe("a/z.md");
    expect(
      await findRenamed("a/x.md", "r9", ["a/x.md", "a/y.md"], at),
    ).toBeNull();
  });
});
