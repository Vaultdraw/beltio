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

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

const PINNED: Record<string, [count: number, why: string]> = {
  "excalidraw-desktop/src/VaultApp.tsx": [1, "toimprove 236"],
  "excalidraw-desktop/src/commands/drawingCommands.ts": [1, "toimprove 236"],
  "excalidraw-desktop/src/components/QuickSwitcher.tsx": [1, "toimprove 236"],
  "excalidraw-desktop/src/components/VaultHeader.tsx": [1, "toimprove 236"],
  "excalidraw-desktop/src/components/VaultNavigator.tsx": [1, "toimprove 236"],
  "excalidraw-desktop/src/components/links/LinksDock.tsx": [1, "toimprove 236"],
  "excalidraw-desktop/src/components/search/SearchResults.tsx": [
    1,
    "toimprove 236",
  ],
  "excalidraw-desktop/src/control/tabList.ts": [2, "toimprove 236"],
  "excalidraw-desktop/src/control/uriRun.ts": [1, "toimprove 206 (K-1)"],
  "excalidraw-desktop/src/control/windowMethods.ts": [1, "toimprove 236"],
  "excalidraw-desktop/src/editor/VaultEditor.tsx": [
    1,
    "toimprove 232 (Save a copy)",
  ],
  "excalidraw-desktop/src/editor/imageExport.ts": [
    1,
    "toimprove 232 (export name)",
  ],
  "excalidraw-desktop/src/editor/links/LinkSuggest.tsx": [1, "toimprove 236"],
  "excalidraw-desktop/src/editor/links/wikiAutocomplete.ts": [
    1,
    "toimprove 236",
  ],
  "excalidraw-desktop/src/history/historyConfirms.ts": [1, "toimprove 236"],
  "excalidraw-desktop/src/links/grammar.ts": [
    1,
    "link targets: .excalidraw is the written form",
  ],
  "excalidraw-desktop/src/palette/group.ts": [2, "toimprove 236"],
  "excalidraw-desktop/src/tabs/useTabs.ts": [1, "toimprove 236"],
  "excalidraw-desktop/src/templates/useTemplates.tsx": [
    1,
    "templates are .excalidraw files",
  ],
  "excalidraw-desktop/src/vault/treeStore.ts": [3, "toimprove 236"],
  "plugins/official/gallery/src/GalleryView.tsx": [1, "toimprove 236"],
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
