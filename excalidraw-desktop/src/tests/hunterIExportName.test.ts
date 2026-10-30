import { describe, expect, it } from "vitest";

import { exportFileName } from "../editor/imageExport";

/**
 * Hunter I-11 (2026-10-30). The export dialog and Copy/Save as PNG, SVG and PDF name the file
 * from the tab's file name (VaultApp passes getBaseName(path)) through `exportFileName`, which
 * strips only ".excalidraw". An Obsidian drawing "Plan.excalidraw.md" exports as
 * "Plan.excalidraw.md.png": an image whose name says Markdown. No app names an image ".md.png";
 * our own drawings export as "Plan.png".
 */
describe("hunter I-11: export file names of Obsidian drawings", () => {
  it.each([
    ["png", "Plan.png"],
    ["svg", "Plan.svg"],
    ["pdf", "Plan.pdf"],
  ] as const)("sanity: Plan.excalidraw exports as %s", (ext, want) => {
    expect(exportFileName("Plan.excalidraw", ext, false)).toBe(want);
  });

  it.each(["png", "svg", "pdf"] as const)(
    "Plan.excalidraw.md exports as a .%s without .md in its name",
    (ext) => {
      expect(exportFileName("Plan.excalidraw.md", ext, false)).not.toMatch(
        /\.md\./,
      );
    },
  );
});

describe("toimprove 232: export names use the name the tree shows", () => {
  it.each([
    ["Plan.excalidraw.md", "png", false, "Plan.png"],
    ["Plan.Excalidraw.MD", "svg", false, "Plan.svg"],
    ["Plan.excalidraw.md", "png", true, "Plan.excalidraw.png"],
    ["v1.2 notes.excalidraw", "pdf", false, "v1.2 notes.pdf"],
    [".excalidraw", "png", false, "Drawing.png"],
  ] as const)("%s as %s (embed %s) is %s", (name, ext, embed, want) => {
    expect(exportFileName(name, ext, embed)).toBe(want);
  });
});
