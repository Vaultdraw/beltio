/** Small pure helpers shared by both renderer backends and the hit grid. */
import type { GraphTheme } from "./types";

export const HIGH_N = 20_000;
export const MAX_HIGH_N_DPR = 1.5;

/** DPR cap: above 20k nodes the fill cost matters more than crispness. */
export function effectiveDpr(dpr: number, n: number): number {
  const d = dpr > 0 ? dpr : 1;
  return n > HIGH_N ? Math.min(d, MAX_HIGH_N_DPR) : d;
}

/** Node radius in CSS px at a zoom (before the 1 device-px AA margin). Used by shader, canvas2d and hit test. */
export function nodeZoomFactor(scale: number): number {
  return Math.min(2.5, Math.max(0.6, Math.sqrt(scale)));
}

/** Hairline edge alpha: fades in with zoom, thins out with edge count. */
export function edgeAlpha(scale: number, m: number): number {
  const density = m > 5000 ? Math.max(0.5, 1 - Math.log10(m / 5000) * 0.5) : 1;
  const a = (0.22 + 0.5 * Math.sqrt(Math.max(scale, 0))) * density;
  return Math.min(0.85, Math.max(0.1, a));
}

export const SOFTWARE_GL = /swiftshader|llvmpipe|software|softpipe/i;

export function isSoftwareRenderer(info: string): boolean {
  return SOFTWARE_GL.test(info);
}

export function packRgba(r: number, g: number, b: number, a = 255): number {
  return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

export type Rgba = [number, number, number, number];

/** Parses the CSS colour forms themes use. Unknown input yields opaque magenta. */
export function parseColour(css: string): Rgba {
  const s = css.trim();
  if (s[0] === "#") {
    let h = s.slice(1);
    if (h.length === 3 || h.length === 4) {
      h = [...h].map((c) => c + c).join("");
    }
    if ((h.length === 6 || h.length === 8) && /^[0-9a-f]+$/i.test(h)) {
      const v = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
      return [v(0), v(2), v(4), h.length === 8 ? v(6) : 1];
    }
  }
  const m = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (m) {
    const p = m[1]
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(parseFloat);
    if (p.length >= 3 && p.every((x) => !Number.isNaN(x))) {
      return [p[0] / 255, p[1] / 255, p[2] / 255, p.length > 3 ? p[3] : 1];
    }
  }
  return [1, 0, 1, 1];
}

export function rgbaCss(c: Rgba, alphaMul = 1): string {
  return `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(
    c[2] * 255,
  )},${c[3] * alphaMul})`;
}

export type ParsedTheme = Record<keyof GraphTheme, Rgba>;

export function parseTheme(t: GraphTheme): ParsedTheme {
  return {
    background: parseColour(t.background),
    edge: parseColour(t.edge),
    edgeHighlight: parseColour(t.edgeHighlight),
    label: parseColour(t.label),
    accent: parseColour(t.accent),
  };
}
