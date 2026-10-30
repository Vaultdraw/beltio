import { describe, expect, it } from "vitest";

import { moveDestination } from "./params";

// Hunter C (2026-10-30, C-8). `vaultdraw mv Plan "Plan old"` (and the control method file.move that the
// CLI, MCP and plugins share) renames a drawing to a file with NO extension: it then vanishes from the
// tree, search and `open` (it is only on disk). `file.create` and `vaultdraw new` add .excalidraw, and the
// in-app rename keeps the extension. Obsidian's rename keeps the note's extension.
describe("file.move keeps a drawing a drawing", () => {
  // `it.fails` passes while the bug exists and turns red when it is fixed: then change it to `it`.
  const cases: [string, string, string][] = [
    ["Plan.excalidraw", "Plan old", "Plan old.excalidraw"],
    ["A/Plan.excalidraw", "A/Plan2", "A/Plan2.excalidraw"],
    ["Plan.excalidraw", "Other/Plan3", "Other/Plan3.excalidraw"],
  ];
  for (const [from, to, expected] of cases) {
    it.fails(`${from} -> ${to} gives ${expected}`, () => {
      expect(moveDestination(from, to)).toBe(expected);
    });
  }
});
