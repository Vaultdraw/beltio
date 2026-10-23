/**
 * "Sync canvas with theme" colour transform.
 */
import { describe, expect, it, vi } from "vitest";

import {
  COLOR_PALETTE,
  DEFAULT_CANVAS_BACKGROUND_PICKS,
} from "@excalidraw/common";

import {
  HUE_FAMILIES,
  buildCanvasColorTransform,
  contrastRatio,
  hexToOklch,
  loadBuiltinThemes,
  mix,
  parseThemeFile,
  resolveFamilyTargets,
} from "../theme";
import { GRAY_MIX, SHADE_MIX } from "../theme/canvas";

import type { ResolvedTheme, ThemeMode } from "../theme";

const MODES: ThemeMode[] = ["dark", "light"];
const themes = await loadBuiltinThemes();
const FAMILIES = [...HUE_FAMILIES, "bronze"] as const;
const fallback = (c: string) => `fallback(${c})`;

const cases = themes.flatMap((t) => MODES.map((m) => [t.id, m] as const));
const byId = (id: string) => themes.find((t) => t.id === id) as ResolvedTheme;

describe("buildCanvasColorTransform", () => {
  it.each(cases)("%s (%s): white, canvas picks and black", (id, mode) => {
    const v = byId(id)[mode];
    const tx = buildCanvasColorTransform(v, mode, fallback);
    for (const dm of [false, true]) {
      expect(tx(COLOR_PALETTE.white, dm)).toBe(v.mSurface);
      expect(tx("#FFFFFF", dm)).toBe(v.mSurface);
      expect(tx("#fff", dm)).toBe(v.mSurface);
      for (const pick of DEFAULT_CANVAS_BACKGROUND_PICKS) {
        expect(tx(pick, dm)).toBe(v.mSurface);
        expect(tx(pick.toUpperCase(), dm)).toBe(v.mSurface);
      }
      expect(tx(COLOR_PALETTE.black, dm)).toBe(v.mOnSurface);
      expect(tx("#1E1E1E", dm)).toBe(v.mOnSurface);
    }
  });

  it.each(cases)("%s (%s): gray ramps from canvas to text", (id, mode) => {
    const v = byId(id)[mode];
    const tx = buildCanvasColorTransform(v, mode, fallback);
    const out = COLOR_PALETTE.gray.map((c) => tx(c, true));
    // gray[0] (#f8f9fa) is also a canvas-background pick: canvas wins.
    expect(out[0]).toBe(v.mSurface);
    for (let i = 1; i < 5; i++) {
      expect(out[i]).toBe(mix(v.mSurface, v.mOnSurface, GRAY_MIX[i]));
      expect(contrastRatio(out[i], v.mSurface)).toBeGreaterThan(
        contrastRatio(out[i - 1], v.mSurface),
      );
    }
  });

  it.each(cases)(
    "%s (%s): hue shades mix canvas → target, shade 4 ≥ 3:1",
    (id, mode) => {
      const v = byId(id)[mode];
      const tx = buildCanvasColorTransform(v, mode, fallback);
      const seen = new Set<string>();
      for (const family of FAMILIES) {
        const shades = COLOR_PALETTE[family].map((c) => tx(c, mode === "dark"));
        for (const s of shades) {
          expect(s).toMatch(/^#[0-9a-f]{6}$/);
        }
        const strong = shades[4];
        expect(
          contrastRatio(strong, v.mSurface),
          `${family} shade 4`,
        ).toBeGreaterThanOrEqual(3);
        for (let i = 0; i < 4; i++) {
          expect(shades[i]).toBe(mix(v.mSurface, strong, SHADE_MIX[i]));
          expect(
            contrastRatio(shades[i + 1], v.mSurface),
          ).toBeGreaterThanOrEqual(contrastRatio(shades[i], v.mSurface) - 0.01);
        }
        seen.add(strong);
      }
      // every family stays distinguishable
      expect(seen.size).toBe(FAMILIES.length);
    },
  );

  it("maps families to theme colours with matching hues", () => {
    const dracula = resolveFamilyTargets(byId("dracula").dark);
    expect(dracula.red).toBe("#ff5555");
    expect(dracula.green).toBe("#50fa7b");
    expect(dracula.cyan).toBe("#8be9fd");
    // Dracula's terminal "blue" is purple: it becomes violet, blue is synthesised
    expect(dracula.violet).toBe("#bd93f9");
    const blueHue = hexToOklch(dracula.blue).h;
    expect(blueHue).toBeGreaterThan(225);
    expect(blueHue).toBeLessThan(280);

    const solarized = resolveFamilyTargets(byId("solarized").light);
    expect(solarized.orange).toBe("#cb4b16");
    expect(solarized.violet).toBe("#6c71c4");
    expect(solarized.blue).toBe("#268bd2");

    // Noctalia's Gruvbox has no orange role: it is synthesised between red and yellow.
    const gruvbox = resolveFamilyTargets(byId("gruvbox").dark);
    expect(gruvbox.red).toBe("#cc241d");
    const orangeHue = hexToOklch(gruvbox.orange).h;
    expect(orangeHue).toBeGreaterThan(hexToOklch(gruvbox.red).h);
    expect(orangeHue).toBeLessThan(hexToOklch(gruvbox.yellow).h);
  });

  it("works for a minimal (derived) theme too", () => {
    const theme = parseThemeFile(
      {
        dark: {
          mSurface: "#101010",
          mOnSurface: "#eeeeee",
          mPrimary: "#ff9900",
        },
      },
      "Mini",
    );
    for (const mode of MODES) {
      const v = theme[mode];
      const tx = buildCanvasColorTransform(v, mode, fallback);
      for (const family of FAMILIES) {
        expect(
          contrastRatio(tx(COLOR_PALETTE[family][4], false), v.mSurface),
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("uses the fallback for unknown colours only in dark mode", () => {
    const v = byId("nord").dark;
    const fb = vi.fn(fallback);
    const tx = buildCanvasColorTransform(v, "dark", fb);
    expect(tx("#123456", false)).toBe("#123456");
    expect(tx("rgb(1, 2, 3)", false)).toBe("rgb(1, 2, 3)");
    expect(fb).not.toHaveBeenCalled();
    expect(tx("#123456", true)).toBe("fallback(#123456)");
    expect(tx("hsl(0, 0%, 50%)", true)).toBe("fallback(hsl(0, 0%, 50%))");
    expect(tx("#12345680", true)).toBe("fallback(#12345680)");
  });

  it("passes transparent through untouched", () => {
    const fb = vi.fn(fallback);
    const tx = buildCanvasColorTransform(byId("default").dark, "dark", fb);
    expect(tx("transparent", true)).toBe("transparent");
    expect(tx("transparent", false)).toBe("transparent");
    expect(tx(COLOR_PALETTE.transparent, true)).toBe("transparent");
    expect(fb).not.toHaveBeenCalled();
  });

  it("preserves alpha", () => {
    const v = byId("catppuccin").dark;
    const tx = buildCanvasColorTransform(v, "dark", fallback);
    const red = tx(COLOR_PALETTE.red[4], true);
    expect(tx(`${COLOR_PALETTE.red[4]}80`, true)).toBe(`${red}80`);
    expect(tx("#ffffff00", true)).toBe(`${v.mSurface}00`);
    expect(tx("#1E1E1E33", false)).toBe(`${v.mOnSurface}33`);
  });

  it("memoises per input", () => {
    const fb = vi.fn(fallback);
    const tx = buildCanvasColorTransform(byId("gruvbox").dark, "dark", fb);
    tx("#abcdef", true);
    tx("#abcdef", true);
    tx("#abcdef", true);
    expect(fb).toHaveBeenCalledTimes(1);
    const a = tx(COLOR_PALETTE.blue[2], true);
    expect(tx(COLOR_PALETTE.blue[2], true)).toBe(a);
  });
});
