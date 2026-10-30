/**
 * Guard (validator, 2026-10-30 evening, hunter I-11 / toimprove 232): `stripDrawingExt` drops
 * only ".excalidraw", so a name made from an Obsidian drawing keeps ".excalidraw.md"
 * ("Plan.excalidraw.md.png", Save a copy "Plan.excalidraw.md.excalidraw"). A name shown to the
 * user or written as a new file comes from `entryDisplayName` (fileKind.ts), which knows both.
 * Each file's count of `stripDrawingExt(` is pinned below; a new call fails here. Use
 * `entryDisplayName`, or add the file with why ".excalidraw" alone is right there.
 * Files marked "toimprove 236" are the I-11 family members still to check or fix.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { drawingDisplayName } from "../commands/drawingCommands";
import { drawingName } from "../history/historyConfirms";
import { drawingStem } from "../vault/fileKind";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

const PINNED: Record<string, [count: number, why: string]> = {
  "excalidraw-desktop/src/control/uriRun.ts": [1, "toimprove 206 (K-1)"],
  "excalidraw-desktop/src/editor/VaultEditor.tsx": [
    1,
    "toimprove 232 (Save a copy)",
  ],
  "excalidraw-desktop/src/editor/imageExport.ts": [
    1,
    "toimprove 232 (export name)",
  ],
  "excalidraw-desktop/src/links/grammar.ts": [
    1,
    "link targets: .excalidraw is the written form",
  ],
  "excalidraw-desktop/src/templates/useTemplates.tsx": [
    1,
    "templates are .excalidraw files",
  ],
  "excalidraw-desktop/src/vault/treeStore.ts": [
    1,
    "duplicateName: the drawing branch (Obsidian drawings keep .excalidraw.md)",
  ],
  "plugins/official/gallery/src/GalleryView.tsx": [
    1,
    "its own copy (a plugin): strips .excalidraw and .excalidraw.md",
  ],
};

const counts = (): Record<string, number> => {
  const out: Record<string, number> = {};
  const files = execFileSync("git", ["ls-files", "*.ts", "*.tsx"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .filter(
      (f) =>
        f &&
        !/\.(test|spec)\.tsx?$/.test(f) &&
        !f.endsWith("src/vault/fileKind.ts"),
    );
  for (const f of files) {
    const n =
      readFileSync(join(root, f), "utf8").split("stripDrawingExt(").length - 1;
    if (n) {
      out[f] = n;
    }
  }
  return out;
};

describe("guard: names drop the whole drawing extension", () => {
  it("no new stripDrawingExt call (use entryDisplayName)", () => {
    const extra = Object.entries(counts()).filter(
      ([f, n]) => n > (PINNED[f]?.[0] ?? 0),
    );
    expect(extra).toEqual([]);
  });
});

describe("toimprove 236: an Obsidian drawing's shown name drops .excalidraw.md", () => {
  it.each([
    ["Plan.excalidraw", "Plan"],
    ["Plan.EXCALIDRAW", "Plan"],
    ["Plan.excalidraw.md", "Plan"],
    ["Ideas.md", "Ideas.md"],
    ["photo.png", "photo.png"],
  ])("drawingStem(%s) is %s", (name, stem) => {
    expect(drawingStem(name)).toBe(stem);
  });

  it("the palette, history and tab names use it", () => {
    expect(drawingDisplayName("Sub/Sketch.excalidraw.md")).toBe("Sketch");
    expect(drawingName("Sub/Sketch.excalidraw.md")).toBe("Sketch");
  });
});
