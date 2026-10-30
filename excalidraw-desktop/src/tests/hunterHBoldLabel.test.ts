import { describe, expect, it, vi } from "vitest";

import { toggleBoldSelected } from "../markdown/boldToggle";
import { selectedTexts } from "../markdown/selectedTexts";

vi.mock("../editor/links/remeasure", () => ({
  fontsReady: async () => undefined,
  measureTextUpdate: () => null,
}));

/**
 * Hunter H-4 (2026-10-30). boldToggle.ts says it toggles "every selected text, or the text it
 * labels", but only keeps elements whose own type is "text". Selecting a rectangle or an
 * ellipse (what a click on a labelled shape selects) and pressing Cmd+B does nothing.
 */
const fake = (selected: string[]) => {
  const rect = {
    id: "r",
    type: "rectangle",
    isDeleted: false,
    boundElements: [{ id: "t", type: "text" }],
  };
  const label = {
    id: "t",
    type: "text",
    isDeleted: false,
    containerId: "r",
    fontFamily: 5,
    text: "Hi",
    version: 1,
    versionNonce: 1,
  };
  let updated: any = null;
  const api = {
    getAppState: () => ({
      selectedElementIds: Object.fromEntries(selected.map((id) => [id, true])),
    }),
    getSceneElementsIncludingDeleted: () => [rect, label],
    updateScene: (s: any) => {
      updated = s;
    },
  };
  return { api: api as never, updated: () => updated };
};

describe("hunter H-4: Cmd+B on a selected labelled shape", () => {
  it("the selected text itself is toggled (sanity)", async () => {
    const f = fake(["t"]);
    expect(await toggleBoldSelected(f.api)).toBe(1);
  });

  it("the selected shape's label is toggled", async () => {
    const f = fake(["r"]);
    expect(await toggleBoldSelected(f.api)).toBe(1);
  });
});

describe("selectedTexts: the family (bold and task toggle share it)", () => {
  const scene = [
    { id: "r", type: "rectangle" },
    { id: "t", type: "text", containerId: "r" },
    { id: "a", type: "arrow" },
    { id: "al", type: "text", containerId: "a" },
    { id: "free", type: "text", containerId: null },
    { id: "gone", type: "text", containerId: "r", isDeleted: true },
  ];

  it("a selected shape or arrow gives its label; a free text gives itself", () => {
    expect(selectedTexts(scene, { r: true, a: true }).map((e) => e.id)).toEqual(
      ["t", "al"],
    );
    expect(selectedTexts(scene, { free: true }).map((e) => e.id)).toEqual([
      "free",
    ]);
  });

  it("shape and label both selected count once; deleted labels never", () => {
    expect(selectedTexts(scene, { r: true, t: true }).map((e) => e.id)).toEqual(
      ["t"],
    );
  });

  it("an unselected shape's label is left alone", () => {
    expect(selectedTexts(scene, { a: true }).map((e) => e.id)).toEqual(["al"]);
  });
});
