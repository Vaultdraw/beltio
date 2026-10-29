import { describe, expect, test } from "vitest";

import { firstPart, matchNotes } from "../src/reimport";

import type { PlanItem } from "../src/obsidian/plan";

const note = (path: string): PlanItem =>
  ({
    kind: "note",
    path,
    target: path.replace(/\.md$/, ".excalidraw"),
  } as PlanItem);

describe("re-import finds the note a drawing came from", () => {
  const items = [
    note("Learning/Kubernetes/kernel.md"),
    note("Flarre AI/SafePoint/Mapping/Data Modelling.md"),
    note("Top.md"),
    {
      kind: "excalidrawMd",
      path: "Excalidraw/D.excalidraw.md",
      target: "Excalidraw/D.excalidraw",
    } as PlanItem,
  ];

  test.each([
    // The import wrote into "Obsidian/", and once more into "Obsidian/Obsidian/".
    [
      "Obsidian/Learning/Kubernetes/kernel.excalidraw",
      "Learning/Kubernetes/kernel.md",
      "Obsidian",
    ],
    [
      "Obsidian/Obsidian/Learning/Kubernetes/kernel.excalidraw",
      "Learning/Kubernetes/kernel.md",
      "Obsidian/Obsidian",
    ],
    [
      "Obsidian/Flarre AI/SafePoint/Mapping/Data Modelling.excalidraw",
      "Flarre AI/SafePoint/Mapping/Data Modelling.md",
      "Obsidian",
    ],
    // Imported straight into the vault's root.
    ["Top.excalidraw", "Top.md", ""],
    // A later part comes from the same note.
    [
      "Obsidian/Learning/Kubernetes/kernel (part 2).excalidraw",
      "Learning/Kubernetes/kernel.md",
      "Obsidian",
    ],
  ])("%s", (drawing, notePath, root) => {
    const m = matchNotes([drawing], items).get(drawing);
    expect(m?.item.path).toBe(notePath);
    expect(m?.root).toBe(root);
  });

  test("drawings with no note, and converted Obsidian drawings, have no match", () => {
    const m = matchNotes(
      [
        "Mine.excalidraw",
        "Obsidian/Excalidraw/D.excalidraw",
        "Obsidian/Learning/Other.excalidraw",
      ],
      items,
    );
    expect(m.size).toBe(0);
  });

  test("firstPart", () => {
    expect(firstPart("a/b (part 12).excalidraw")).toBe("a/b.excalidraw");
    expect(firstPart("a/b (part one).excalidraw")).toBe(
      "a/b (part one).excalidraw",
    );
  });
});
