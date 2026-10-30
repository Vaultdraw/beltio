import { describe, expect, it, vi } from "vitest";

import { toggleBoldSelected } from "../markdown/boldToggle";

vi.mock("../editor/links/remeasure", () => ({
  fontsReady: async () => undefined,
  measureTextUpdate: () => null,
}));

/**
 * Hunter I-6 (2026-10-30). Toggle bold (Cmd+B) decides "all bold already?" with `isBoldFont`,
 * which is false for a family without a bold face (Lilita One 7, Assistant 10). With such a
 * text in the selection, the first Cmd+B makes the others bold and every later Cmd+B finds
 * "not all bold", has nothing left to make bold, and does nothing: the others can never go
 * back to regular from the keyboard. Obsidian's Cmd+B always flips.
 */
const scene = (fonts: number[]) => {
  let els: any[] = fonts.map((fontFamily, i) => ({
    id: `t${i}`,
    type: "text",
    isDeleted: false,
    fontFamily,
    text: `t${i}`,
    version: 1,
    versionNonce: 1,
  }));
  const api = {
    getAppState: () => ({
      selectedElementIds: Object.fromEntries(els.map((e) => [e.id, true])),
    }),
    getSceneElementsIncludingDeleted: () => els,
    updateScene: (s: { elements: any[] }) => {
      els = s.elements;
    },
  };
  return { api: api as never, fonts: () => els.map((e) => e.fontFamily) };
};

describe("hunter I-6: Cmd+B with a font that has no bold face in the selection", () => {
  it("sanity: two Excalifont texts go bold and back", async () => {
    const s = scene([5, 5]);
    await toggleBoldSelected(s.api);
    expect(s.fonts()).toEqual([105, 105]);
    await toggleBoldSelected(s.api);
    expect(s.fonts()).toEqual([5, 5]);
  });

  it.fails.each([7, 10])(
    "with family %i selected too, the second Cmd+B makes the Excalifont text regular again",
    async (other) => {
      const s = scene([5, other]);
      await toggleBoldSelected(s.api);
      expect(s.fonts()).toEqual([105, other]);
      await toggleBoldSelected(s.api);
      expect(s.fonts()).toEqual([5, other]);
    },
  );
});
