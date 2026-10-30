import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { fileKind, hasDrawingExt } from "../vault/fileKind";
import { drawingCopyName, duplicateName } from "../vault/treeStore";

/**
 * Validator V-2 (2026-10-30, review of 73d05967). "Duplicate drawing" (palette, `file.duplicate`,
 * offered whenever a drawing is open and the vault is writable) on an open Obsidian drawing
 * (`Sketch.excalidraw.md`, shown read-only) calls `VaultApp.handleDuplicateDrawing`, which writes
 * `duplicateName(path)` with `writeNewDrawing`. Before 73d05967 that name was
 * `Sketch.excalidraw.md copy.excalidraw` (an editable copy: odd name, but it worked). Since then
 * `duplicateName` keeps `.excalidraw.md`, and the native writer (`drawing.rs
 * write_drawing_file_with_commit`, `has_drawing_ext`) refuses it: "Couldn't duplicate ...: Drawing
 * filenames must end in .excalidraw". The native rule and `hasDrawingExt` are twins pinned by
 * fixtures/filekind.json, so `hasDrawingExt` stands for the native answer here.
 * Expected: an editable `Sketch copy.excalidraw` (the banner on an Obsidian drawing already points
 * to an editable .excalidraw copy).
 */
const app = readFileSync(resolve(__dirname, "../VaultApp.tsx"), "utf8");
const body = (name: string) => {
  const at = app.indexOf(`const ${name} = async`);
  return app.slice(at, app.indexOf("\n  };", at));
};

describe("validator V-2: Duplicate drawing on an open Obsidian drawing", () => {
  it("(context) the duplicate name of an Obsidian drawing is not one the drawing writer accepts", () => {
    const target = duplicateName("Sub/Sketch.excalidraw.md");
    expect(fileKind(target)).toBe("excalidrawMd");
    expect(hasDrawingExt(target)).toBe(false);
  });

  it("Duplicate drawing writes drawingCopyName(path) as a drawing", () => {
    expect(body("handleDuplicateDrawing")).toContain("drawingCopyName(path)");
    expect(body("handleDuplicateDrawing")).toContain("writeNewDrawing");
  });

  it("the copy of an Obsidian drawing is a .excalidraw drawing the app can write", () => {
    expect(body("handleDuplicateDrawing")).toMatch(
      /excalidrawMd|stripExcalidrawMd|drawingCopyName/,
    );
  });

  it.each([
    ["Sub/Sketch.excalidraw.md", "Sub/Sketch copy.excalidraw"],
    ["Sketch copy.excalidraw.md", "Sketch copy 2.excalidraw"],
    ["Plan.excalidraw", "Plan copy.excalidraw"],
  ])(
    "drawingCopyName(%s) is %s, a name the drawing writer accepts",
    (from, to) => {
      expect(drawingCopyName(from)).toBe(to);
      expect(hasDrawingExt(drawingCopyName(from))).toBe(true);
    },
  );
});
