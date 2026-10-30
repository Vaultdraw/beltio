import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { fileKind } from "../vault/fileKind";

/**
 * Hunter F-7 (2026-10-30). `useTabs.ts` findRenamed (the follow of an outside rename or move)
 * decides "is this tab a note" with `path.toLowerCase().endsWith(".md")`. An Obsidian drawing
 * (`Idea.excalidraw.md`, kind excalidrawMd, "a drawing, never a note") ends with `.md` too, so a
 * background tab of one is asked for a saved NOTE revision (`savedNoteRevision`, always null for
 * it) and never follows the rename, where a plain `.excalidraw` background tab does
 * (`memory.revisionOf`). The rest of the app asks `fileKind` / `isNotePath`.
 */
describe("hunter F-7: the outside-rename follow knows an Obsidian drawing is not a note", () => {
  const source = readFileSync(resolve(__dirname, "../tabs/useTabs.ts"), "utf8");

  it("(context) the two kinds both end in .md", () => {
    expect(fileKind("Idea.excalidraw.md")).toBe("excalidrawMd");
    expect("Idea.excalidraw.md".endsWith(".md")).toBe(true);
  });

  it("findRenamed does not classify by a bare .md suffix", () => {
    expect(source).not.toMatch(
      /const note = path\.toLowerCase\(\)\.endsWith\("\.md"\)/,
    );
  });
});
