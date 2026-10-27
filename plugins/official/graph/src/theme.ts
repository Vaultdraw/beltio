/**
 * Graph colours from the app theme. `readGraphTokens` reads the `--vault-*` CSS variables once at
 * open and again when `themeKey` changes; everything else here is pure so it can be unit tested.
 */
import { parseColour, rgbaCss } from "./renderer/shared";

import type { Rgba } from "./renderer/shared";
import type { GraphTheme } from "./renderer/types";

export interface GraphTokens {
  bg: string;
  text: string;
  textFaint: string;
  primary: string;
  success: string;
  warning: string;
  danger: string;
  font: string;
}

export interface GraphPalette {
  /** Folder colours, indexed by `folder % length`. */
  folder: string[];
  mono: string;
  ghost: string;
  tag: string;
}

export interface GraphColours {
  theme: GraphTheme;
  palette: GraphPalette;
  font: string;
}

export const FALLBACK_TOKENS: GraphTokens = {
  bg: "#ffffff",
  text: "#1d1d20",
  textFaint: "#9b9ba3",
  primary: "#6965db",
  success: "#1b8a3e",
  warning: "#b26200",
  danger: "#d13232",
  font: "sans-serif",
};

const VARS: Record<keyof GraphTokens, string> = {
  bg: "--vault-bg",
  text: "--vault-text",
  textFaint: "--vault-text-faint",
  primary: "--vault-primary",
  success: "--vault-success",
  warning: "--vault-warning",
  danger: "--vault-danger",
  font: "--vault-font",
};

export function readGraphTokens(el: Element): GraphTokens {
  const cs = getComputedStyle(el);
  const out = { ...FALLBACK_TOKENS };
  for (const k of Object.keys(VARS) as (keyof GraphTokens)[]) {
    const v = cs.getPropertyValue(VARS[k]).trim();
    if (v) {
      out[k] = v;
    }
  }
  return out;
}

const hex2 = (v: number) =>
  Math.round(Math.min(1, Math.max(0, v)) * 255)
    .toString(16)
    .padStart(2, "0");

export const toHex = (c: Rgba) => `#${hex2(c[0])}${hex2(c[1])}${hex2(c[2])}`;

/** `t` = share of `b` in the mix (0 = a, 1 = b). Alpha is taken from `a`. */
export function mixColours(a: string, b: string, t: number): string {
  const x = parseColour(a);
  const y = parseColour(b);
  return rgbaCss([
    x[0] + (y[0] - x[0]) * t,
    x[1] + (y[1] - x[1]) * t,
    x[2] + (y[2] - x[2]) * t,
    x[3],
  ]);
}

function rgbToHsl([r, g, b]: Rgba): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) {
    return [0, 0, l];
  }
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) {
    h = (g - b) / d + (g < b ? 6 : 0);
  } else if (max === g) {
    h = (b - r) / d + 2;
  } else {
    h = (r - g) / d + 4;
  }
  return [h * 60, s, l];
}

function hslToRgb(h: number, s: number, l: number): Rgba {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) =>
    l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4), 1];
}

/** The primary colour turned around the hue wheel (keeps its lightness, floors saturation). */
export function rotateHue(css: string, degrees: number): string {
  const [h, s, l] = rgbToHsl(parseColour(css));
  return toHex(hslToRgb((h + degrees + 360) % 360, Math.max(s, 0.45), l));
}

const ROTATIONS = [70, 140, 210, 280, 330];

export function buildPalette(t: GraphTokens): GraphPalette {
  return {
    folder: [
      t.primary,
      t.success,
      t.warning,
      t.danger,
      ...ROTATIONS.map((d) => rotateHue(t.primary, d)),
    ],
    mono: mixColours(t.text, t.bg, 0.4),
    ghost: t.textFaint,
    tag: mixColours(t.warning, t.text, 0.25),
  };
}

export function deriveGraphColours(t: GraphTokens): GraphColours {
  return {
    theme: {
      background: t.bg,
      edge: mixColours(t.text, t.bg, 0.55),
      edgeHighlight: t.primary,
      label: t.text,
      accent: t.primary,
    },
    palette: buildPalette(t),
    font: `11px ${t.font}`,
  };
}
