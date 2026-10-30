import { afterEach, describe, expect, it, vi } from "vitest";

import {
  registerCanvasRepaint,
  resetCanvasSync,
  setInvertSvgInDark,
} from "../editor/canvasSync";
import { DEFAULT_PREFERENCES } from "../vault/preferences";
import { configToPreferences } from "../vault/settingsSync";

/**
 * toimprove 133: `appearance.invert_svg_in_dark` (on by default, like
 * Excalidraw) decides whether SVG pictures are drawn inverted in dark mode.
 * The renderers' side is pinned in packages/excalidraw/tests/scene/invertSvgInDark.test.ts.
 */
describe("appearance.invert_svg_in_dark", () => {
  afterEach(() => {
    setInvertSvgInDark(true);
    resetCanvasSync();
  });

  it("defaults to on, like Excalidraw", () => {
    expect(DEFAULT_PREFERENCES.invertSvgInDark).toBe(true);
  });

  it("is read from config.toml; a wrong type is reported and keeps the default", () => {
    expect(
      configToPreferences({ appearance: { invert_svg_in_dark: false } }).values
        .invertSvgInDark,
    ).toBe(false);
    const bad = configToPreferences({
      appearance: { invert_svg_in_dark: "no" },
    });
    expect(bad.values.invertSvgInDark).toBe(true);
    expect(bad.problems.map((p) => p.key)).toContain(
      "appearance.invert_svg_in_dark",
    );
  });

  it("a change repaints the open editors (live reload); the same value does not", () => {
    const repaint = vi.fn();
    registerCanvasRepaint(repaint);
    expect(setInvertSvgInDark(true)).toBe(false);
    expect(repaint).not.toHaveBeenCalled();
    expect(setInvertSvgInDark(false)).toBe(true);
    expect(repaint).toHaveBeenCalledTimes(1);
  });
});
