import { describe, expect, it, vi } from "vitest";

import { toggleBoldSelected } from "../markdown/boldToggle";

/**
 * Hunter I-2 (2026-10-30). "Markdown: Toggle bold" (Cmd+B) on selected texts reads the scene,
 * waits for the bold font to load (up to 2 s, `fontsReady`), then writes back the scene it read
 * BEFORE the wait. Anything that changed in between (a shape drawn, a text typed, an outside
 * change reloaded, a plugin edit) is dropped by `updateScene`, which replaces every element.
 * `remeasureElements` in the same folder re-reads the scene after the wait for this reason.
 */
let releaseFonts: () => void = () => {};
vi.mock("../editor/links/remeasure", () => ({
  fontsReady: () =>
    new Promise<void>((resolve) => {
      releaseFonts = resolve;
    }),
  measureTextUpdate: () => null,
}));

const text = (id: string) => ({
  id,
  type: "text",
  isDeleted: false,
  fontFamily: 5,
  text: id,
  version: 1,
  versionNonce: 1,
});

describe("hunter I-2: Toggle bold keeps what changed while the font loaded", () => {
  it.fails(
    "a shape added during the font wait is still in the scene after the toggle",
    async () => {
      let scene: any[] = [text("a")];
      let written: any[] | null = null;
      const api = {
        getAppState: () => ({ selectedElementIds: { a: true } }),
        getSceneElementsIncludingDeleted: () => scene,
        updateScene: (s: { elements: any[] }) => {
          written = s.elements;
          scene = s.elements;
        },
      };
      const done = toggleBoldSelected(api as never);
      // the user draws a rectangle while the bold face loads
      scene = [
        ...scene,
        { id: "r", type: "rectangle", isDeleted: false, version: 1 },
      ];
      releaseFonts();
      expect(await done).toBe(1);
      expect(written!.map((e) => e.id)).toEqual(["a", "r"]);
    },
  );
});
