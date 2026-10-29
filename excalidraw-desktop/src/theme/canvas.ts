/**
 * "Sync canvas with theme": maps Excalidraw's built-in palette colours onto
 * the active theme so drawings made with the stock picker read as part of the
 * theme. Everything else falls back to Excalidraw's own dark-mode filter.
 *
 * Mapping (see `buildCanvasPaletteMap`):
 *   transparent                       -> unchanged
 *   white + DEFAULT_CANVAS_BACKGROUND_PICKS -> canvas (mSurface)
 *   black (#1e1e1e)                   -> mOnSurface
 *   gray[0..4]                        -> canvas→text ramp (6, 15, 30, 55, 85 %)
 *   hue families (red … orange)       -> theme colour, see resolveFamilyTargets
 *   bronze                            -> orange target desaturated towards text
 *   Markdown role colours (ROLE_COLORS) -> the theme's Markdown colour of that role
 *                                        (markdown.ts), as the theme sets or derives it
 *   shade i (0 lightest fill … 4 stroke) -> mix(canvas, target, 12/30/55/80/100 %),
 *                                        shade 4 nudged to ≥ 3:1 on the canvas
 */

import {
  COLOR_PALETTE,
  DEFAULT_CANVAS_BACKGROUND_PICKS,
} from "@excalidraw/common";

import {
  ensureContrast,
  hexToOklch,
  mix,
  mixOklch,
  normalizeHex,
  oklchToHex,
  parseHex,
} from "./color";

import { ROLE_COLORS } from "../../../sdk/api/shared/markdownRoles";

import { MARKDOWN_ROLES, markdownColors } from "./markdown";

import type { ThemeMode, ThemeVariant } from "./types";

export const HUE_FAMILIES = [
  "red",
  "pink",
  "grape",
  "violet",
  "blue",
  "cyan",
  "teal",
  "green",
  "yellow",
  "orange",
] as const;

export type HueFamily = typeof HUE_FAMILIES[number];

export const SHADE_MIX = [0.12, 0.3, 0.55, 0.8, 1] as const;
export const GRAY_MIX = [0.06, 0.15, 0.3, 0.55, 0.85] as const;
export const SHADE4_MIN_CONTRAST = 3;
const MIN_CHROMA = 0.05;
const CACHE_LIMIT = 4096;

const hueDistance = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** The family's reference hue = circular mean OKLCH hue of open-color shades 2–4. */
const familyHue = (family: HueFamily) => {
  let x = 0;
  let y = 0;
  for (const hex of COLOR_PALETTE[family].slice(2)) {
    const { h } = hexToOklch(hex);
    x += Math.cos((h * Math.PI) / 180);
    y += Math.sin((h * Math.PI) / 180);
  }
  return ((((Math.atan2(y, x) * 180) / Math.PI) % 360) + 360) % 360;
};

/** Families with a natural terminal slot. */
const SLOT_FAMILIES = {
  red: "red",
  yellow: "yellow",
  green: "green",
  cyan: "cyan",
  blue: "blue",
  grape: "magenta",
} as const;

/** Families that sit between two slot families on the hue wheel. */
const BETWEEN_FAMILIES = {
  pink: ["red", "grape"],
  violet: ["grape", "blue"],
  teal: ["cyan", "green"],
  orange: ["red", "yellow"],
} as const;

/** A terminal slot is trusted if its hue is within this of the family's. */
export const SLOT_HUE_TOLERANCE = 40;
/** Any other palette colour may stand in for a slot family within this. */
export const POOL_HUE_TOLERANCE = 30;
/** …and for an in-between family (else the two neighbours are blended). */
export const BETWEEN_HUE_TOLERANCE = 15;

/**
 * Theme colour chosen for each family (before shading/contrast):
 *
 * 1. Slot families (red, yellow, green, cyan, blue, grape→magenta) take the
 *    terminal normal/bright colour of that name whose hue is closest to the
 *    family's, if within 40°. Palettes that reuse slots for other hues (e.g.
 *    Dracula's purple "blue", Rosé Pine's rose "cyan") fall through to
 *    2. the nearest-hue unused palette colour (terminal, mPrimary,
 *    mSecondary, mTertiary, mError) within 30°, else
 *    3. a colour synthesised at the family hue with the palette's median
 *    OKLCH lightness/chroma.
 * 4. In-between families (pink, violet, teal, orange) use an unused palette
 *    colour within 15° of their hue (accents first: this is where mPrimary /
 *    mSecondary / mTertiary usually land), else an OKLCH blend of their two
 *    neighbours.
 * 5. bronze = the orange target desaturated 45% towards text.
 */
export const resolveFamilyTargets = (
  variant: ThemeVariant,
): Record<HueFamily | "bronze", string> => {
  const term = variant.terminal;
  const accents = [
    variant.mPrimary,
    variant.mSecondary,
    variant.mTertiary,
    variant.mError,
  ];
  const termColors = (
    ["red", "green", "yellow", "blue", "magenta", "cyan"] as const
  ).flatMap((k) => [term.normal[k], term.bright[k]]);
  const pool = [...new Set([...accents, ...termColors])]
    .map((hex) => ({ hex, lch: hexToOklch(hex) }))
    .filter((c) => c.lch.c >= MIN_CHROMA);
  const used = new Set<string>();
  const out = {} as Record<HueFamily | "bronze", string>;

  const nearestUnused = (hue: number, tolerance: number) => {
    let best: { hex: string; d: number } | null = null;
    for (const c of pool) {
      const d = hueDistance(hue, c.lch.h);
      if (!used.has(c.hex) && d <= tolerance && (!best || d < best.d)) {
        best = { hex: c.hex, d };
      }
    }
    return best?.hex ?? null;
  };

  const refL = pool.length
    ? median(pool.map((c) => c.lch.l))
    : hexToOklch(variant.mPrimary).l;
  const refC = pool.length
    ? Math.max(0.09, median(pool.map((c) => c.lch.c)))
    : 0.14;

  for (const [family, slot] of Object.entries(SLOT_FAMILIES) as Array<
    [
      keyof typeof SLOT_FAMILIES,
      typeof SLOT_FAMILIES[keyof typeof SLOT_FAMILIES],
    ]
  >) {
    const hue = familyHue(family);
    const slotPick = [term.normal[slot], term.bright[slot]]
      .map((hex) => ({ hex, lch: hexToOklch(hex) }))
      .filter(
        (c) =>
          c.lch.c >= MIN_CHROMA &&
          !used.has(c.hex) &&
          hueDistance(hue, c.lch.h) <= SLOT_HUE_TOLERANCE,
      )
      .sort(
        (a, b) => hueDistance(hue, a.lch.h) - hueDistance(hue, b.lch.h),
      )[0]?.hex;
    const pick =
      slotPick ??
      nearestUnused(hue, POOL_HUE_TOLERANCE) ??
      oklchToHex({ l: refL, c: refC, h: hue });
    out[family] = pick;
    used.add(pick);
  }

  for (const [family, [a, b]] of Object.entries(BETWEEN_FAMILIES) as Array<
    [
      keyof typeof BETWEEN_FAMILIES,
      readonly [keyof typeof SLOT_FAMILIES, keyof typeof SLOT_FAMILIES],
    ]
  >) {
    const pick =
      nearestUnused(familyHue(family), BETWEEN_HUE_TOLERANCE) ??
      mixOklch(out[a], out[b], 0.5);
    out[family] = pick;
    used.add(pick);
  }

  out.bronze = mix(out.orange, variant.mOnSurface, 0.45);
  return out;
};

/** Full lookup table: lowercase `#rrggbb` palette colour -> themed `#rrggbb`. */
export const buildCanvasPaletteMap = (
  variant: ThemeVariant,
): Map<string, string> => {
  const canvas = variant.mSurface;
  const text = variant.mOnSurface;
  const map = new Map<string, string>();
  const set = (from: string, to: string) => {
    const key = normalizeHex(from);
    // First writer wins: canvas picks are registered first and take priority
    // (gray[0] #f8f9fa is also a canvas pick).
    if (key && !map.has(key)) {
      map.set(key, to);
    }
  };

  // Markdown roles of imported notes: the theme's own colour for each role.
  const md = markdownColors(variant);
  for (const role of MARKDOWN_ROLES) {
    set(ROLE_COLORS[role], md[role]);
  }
  set(COLOR_PALETTE.white, canvas);
  for (const pick of DEFAULT_CANVAS_BACKGROUND_PICKS) {
    set(pick, canvas);
  }
  set(COLOR_PALETTE.black, text);
  COLOR_PALETTE.gray.forEach((c, i) => set(c, mix(canvas, text, GRAY_MIX[i])));

  const targets = resolveFamilyTargets(variant);
  for (const family of [...HUE_FAMILIES, "bronze"] as const) {
    const strong = ensureContrast(targets[family], canvas, SHADE4_MIN_CONTRAST);
    COLOR_PALETTE[family].forEach((c, i) =>
      set(c, i === 4 ? strong : mix(canvas, strong, SHADE_MIX[i])),
    );
  }
  return map;
};

/**
 * Builds the per-colour transform used while "sync canvas with theme" is on.
 *
 * @param variant the active (already mode-selected) theme variant
 * @param mode    the active mode (kept for API symmetry / future tuning)
 * @param darkFallback transform for non-palette colours in dark mode
 *                     (normally Excalidraw's `applyDarkModeFilter`)
 */
export const buildCanvasColorTransform = (
  variant: ThemeVariant,
  _mode: ThemeMode,
  darkFallback: (color: string) => string,
): ((color: string, isDarkMode: boolean) => string) => {
  const table = buildCanvasPaletteMap(variant);
  const cache = new Map<string, string>();

  return (color: string, isDarkMode: boolean) => {
    const key = `${isDarkMode ? "d" : "l"}${color}`;
    const hit = cache.get(key);
    if (hit !== undefined) {
      return hit;
    }
    let result: string;
    const trimmed = typeof color === "string" ? color.trim() : color;
    if (
      typeof trimmed === "string" &&
      trimmed.toLowerCase() === "transparent"
    ) {
      result = color;
    } else {
      const rgba = typeof trimmed === "string" ? parseHex(trimmed) : null;
      const mapped = rgba
        ? table.get(normalizeHex(trimmed) as string)
        : undefined;
      if (rgba && mapped !== undefined) {
        result =
          rgba.a < 1
            ? `${mapped}${Math.round(rgba.a * 255)
                .toString(16)
                .padStart(2, "0")}`
            : mapped;
      } else {
        result = isDarkMode ? darkFallback(color) : color;
      }
    }
    if (cache.size >= CACHE_LIMIT) {
      cache.clear();
    }
    cache.set(key, result);
    return result;
  };
};
