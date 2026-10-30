import { describe, expect, it } from "vitest";

import { tabLabels } from "./tabLabels";

const t = (path: string | null) => ({ path });

/**
 * Hunter E-4 (2026-10-30, quiet): a note and a drawing of the same name in one folder (the
 * Markdown import writes `Idea.excalidraw` next to `Idea.md`; Obsidian keeps `.excalidraw.md` next
 * to both) get the same tab label, and every tab shows the same drawing icon, so the user cannot
 * tell the two tabs apart. Obsidian shows the extension of anything that is not a note.
 * Drop `fails` when the labels tell them apart.
 */
describe("hunter E-4: tab labels of same-named files of different kinds", () => {
  it("a note and a drawing in one folder read differently", () => {
    const labels = tabLabels([t("Notes/Idea.md"), t("Notes/Idea.excalidraw")]);
    expect(new Set(labels).size).toBe(2);
  });
  it("a drawing, a note and an Obsidian drawing read differently", () => {
    const labels = tabLabels([
      t("Idea.excalidraw"),
      t("Idea.md"),
      t("Idea.excalidraw.md"),
    ]);
    expect(new Set(labels).size).toBe(3);
  });
});
