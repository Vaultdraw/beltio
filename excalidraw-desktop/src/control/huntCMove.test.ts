import { describe, expect, it } from "vitest";

import { moveDestination } from "./params";

// Hunter C (2026-10-30, C-8). `vaultdraw mv Plan "Plan old"` (and the control method file.move that the
// CLI, MCP and plugins share) renamed a drawing to a file with NO extension: it vanished from the
// tree, search and `open`. `file.create` and `vaultdraw new` add .excalidraw, the in-app rename keeps
// the extension, and Obsidian's rename keeps a note's .md. One table: from, to, expected.
describe("file.move keeps a file its kind", () => {
  const cases: [string, string, string][] = [
    ["Plan.excalidraw", "Plan old", "Plan old.excalidraw"],
    ["A/Plan.excalidraw", "A/Plan2", "A/Plan2.excalidraw"],
    ["Plan.excalidraw", "Other/Plan3", "Other/Plan3.excalidraw"],
    // A dot inside the name is not an extension.
    ["Plan.excalidraw", "Plan v1.2", "Plan v1.2.excalidraw"],
    // Notes and Obsidian Excalidraw files keep theirs.
    ["Notes/Idea.md", "Notes/Idea 2", "Notes/Idea 2.md"],
    ["Board.excalidraw.md", "Board 2", "Board 2.excalidraw.md"],
    // Upper-case extensions count as the kind too.
    ["Plan.EXCALIDRAW", "Plan 4", "Plan 4.excalidraw"],
    ["Plan.excalidraw", "Plan 5.EXCALIDRAW", "Plan 5.EXCALIDRAW"],
    // A name that already says what it is wins.
    ["Plan.excalidraw", "Plan.excalidraw", "Plan.excalidraw"],
    ["Idea.md", "Idea.excalidraw", "Idea.excalidraw"],
    // Folders and other files never get an extension.
    ["Sub", "Sub2", "Sub2"],
    ["Sub", "Other/Sub", "Other/Sub"],
    ["pic.png", "pic2", "pic2"],
    // Into a folder keeps the file name; into the root too.
    ["A/Plan.excalidraw", "B/", "B/Plan.excalidraw"],
    ["A/Plan.excalidraw", "/", "Plan.excalidraw"],
  ];
  for (const [from, to, expected] of cases) {
    it(`${from} -> ${to} gives ${expected}`, () => {
      expect(moveDestination(from, to)).toBe(expected);
    });
  }
});
