/**
 * Variant -> `--vault-*` CSS custom properties (see VaultShell.css `:root` /
 * `html.dark` for the meaning of each).
 *
 * Design: the whole app should feel like one surface with the canvas.
 *   --vault-canvas / --vault-bg   = mSurface (exactly the canvas colour)
 *   --vault-surface (header, sidebar) = mSurface stepped a hair (ΔE≈0.028)
 *                                   towards mSurfaceVariant (or text)
 *   --vault-menu-bg               = a raised surface (lighter in dark mode,
 *                                   brightest surface in light mode)
 * Guarantees (WCAG): text ≥ 7:1, muted ≥ 4.5:1, faint ≥ 3:1 on bg, surface
 * and menu; on-primary ≥ 4.5:1 on primary (hover/active only move away from it);
 * on-danger ≥ 4.5:1 on danger; accent-text ≥ 4.5:1 on bg, surface and menu;
 * text ≥ 4.5:1 on every state tint (hover / selected / chip) over those.
 *
 * Design system (personal/feature/ui-redesign/PLAN.md): state tints are
 * translucent rgba literals computed here once per theme, not CSS color-mix,
 * so nothing is re-resolved per element and every pair is unit-tested.
 */

import {
  adjustLightness,
  blendOver,
  contrastRatio,
  ensureContrast,
  ensureContrastAll,
  hexToOklab,
  mix,
  oklabDistance,
  pickOn,
  stepToward,
  toRgba,
} from "./color";

import { MARKDOWN_ROLES, markdownColors, markdownToken } from "./markdown";

import type {
  ThemeMode,
  ThemeTokens,
  ThemeVariant,
  TokenName,
} from "./types";

/** `--vault-md-*`: the theme's Markdown colours (markdown.ts). */
const markdownTokens = (variant: ThemeVariant) => {
  const md = markdownColors(variant);
  return Object.fromEntries(
    MARKDOWN_ROLES.map((r) => [markdownToken(r), md[r]]),
  ) as Pick<ThemeTokens, Extract<TokenName, `--vault-md-${string}`>>;
};

/** Largest OKLab step that still reads as "the accent" when used as text. */
export const ACCENT_TEXT_MAX_NUDGE = 0.06;

/** Alphas of the translucent state tokens (design system, board 1). */
export const STATE_ALPHA = {
  hover: { dark: 0.06, light: 0.05 },
  chip: 0.08,
  chipStrong: 0.14,
  selected: 0.14,
  selectedStrong: 0.26,
  ring: 0.75,
  scrim: 0.32,
} as const;

/** Token names whose value is not a plain `#rrggbb` (rgba, shadows, rings). */
export const NON_HEX_TOKENS: ReadonlySet<string> = new Set([
  "--vault-shadow-sm",
  "--vault-shadow-md",
  "--vault-shadow-lg",
  "--vault-shadow-island",
  "--vault-shadow-pop",
  "--vault-hover",
  "--vault-chip",
  "--vault-chip-strong",
  "--vault-sel",
  "--vault-sel-strong",
  "--vault-ring",
  "--vault-ring-inset",
  "--vault-scrim",
]);

/**
 * Text colour for a filled control: the palette's own when it reads, else
 * whichever of surface / on-surface contrasts better (design rule), nudged
 * to `min` only if neither does.
 */
const onFill = (fill: string, own: string, bg: string, text: string) => {
  const [best, other] =
    contrastRatio(bg, fill) >= contrastRatio(text, fill)
      ? [bg, text]
      : [text, bg];
  return pickOn(fill, [own, best, other], CONTRAST.onPrimary);
};

export const CONTRAST = {
  text: 7,
  muted: 4.5,
  faint: 3,
  onPrimary: 4.5,
  /** status colours are used as text on their own -bg and on surfaces */
  status: 4.5,
} as const;

const SHADOW_ALPHA: Record<ThemeMode, [number, number, number]> = {
  light: [0.05, 0.08, 0.12],
  dark: [0.3, 0.35, 0.5],
};

export const deriveTokens = (
  variant: ThemeVariant,
  mode: ThemeMode,
): ThemeTokens => {
  const dark = mode === "dark";
  const canvas = variant.mSurface;
  const bg = canvas;
  const onSurface = variant.mOnSurface;

  // Chrome: a gentle step from the canvas towards the palette's own
  // surface-variant (keeps its tint); towards text if the variant is too close.
  const chromeTarget =
    oklabDistance(canvas, variant.mSurfaceVariant) >= 0.03
      ? variant.mSurfaceVariant
      : onSurface;
  const surface = stepToward(canvas, chromeTarget, 0.028);
  const surfaceHover = stepToward(surface, onSurface, 0.045);
  const surfaceActive = mix(surface, variant.mPrimary, dark ? 0.16 : 0.12);

  const border = stepToward(surface, onSurface, dark ? 0.045 : 0.05);
  const borderStrong = stepToward(surface, onSurface, dark ? 0.09 : 0.1);

  const text = ensureContrastAll(onSurface, [bg, surface], CONTRAST.text);

  let menu: string;
  if (dark) {
    // Raised = lighter, but never so light that text drops below 7:1.
    let lift = 0.07;
    menu = stepToward(canvas, onSurface, lift);
    while (contrastRatio(text, menu) < CONTRAST.text && lift > 0) {
      lift = Math.max(0, lift - 0.005);
      menu = stepToward(canvas, onSurface, lift);
    }
  } else {
    // Raised = the brightest surface.
    const base =
      hexToOklab(canvas).l >= hexToOklab(surface).l ? canvas : surface;
    menu = hexToOklab(base).l > 0.97 ? base : stepToward(base, "#ffffff", 0.02);
  }

  const textBgs = [bg, surface, menu];

  // Muted: palette's on-surface-variant when it really is quieter than text.
  const mutedSeed =
    contrastRatio(variant.mOnSurfaceVariant, bg) <
      contrastRatio(text, bg) - 0.5 &&
    contrastRatio(variant.mOnSurfaceVariant, bg) > 2
      ? variant.mOnSurfaceVariant
      : mix(text, bg, 0.35);
  const textMuted = ensureContrastAll(mutedSeed, textBgs, CONTRAST.muted);
  const textFaint = ensureContrastAll(
    mix(textMuted, bg, 0.35),
    textBgs,
    CONTRAST.faint,
  );

  // Primary: keep the palette accent, only nudged if it vanishes into the UI.
  const primary = ensureContrastAll(variant.mPrimary, [bg, surface], 3);
  const onPrimary = onFill(primary, variant.mOnPrimary, bg, text);
  // Hover/active move away from the on-primary colour so its label only
  // gains contrast (light label → darker states, dark label → lighter).
  const away = hexToOklab(onPrimary).l > hexToOklab(primary).l ? -1 : 1;
  const primaryHover = adjustLightness(primary, away * (dark ? 0.04 : 0.05));
  const primaryActive = adjustLightness(primary, away * (dark ? 0.08 : 0.1));
  const primaryLight = mix(bg, primary, dark ? 0.15 : 0.1);
  const primaryBorder = mix(bg, primary, dark ? 0.4 : 0.3);

  const status = (seed: string) => {
    const bgTint = mix(bg, seed, dark ? 0.14 : 0.09);
    const fg = ensureContrastAll(seed, [bg, surface, bgTint], CONTRAST.status);
    return {
      fg,
      bg: mix(bg, fg, dark ? 0.14 : 0.09),
      border: mix(bg, fg, dark ? 0.35 : 0.28),
    };
  };
  // Re-check fg against the final tint (it is derived from the adjusted fg).
  const finalize = (s: ReturnType<typeof status>) => ({
    ...s,
    fg: ensureContrastAll(s.fg, [bg, surface, s.bg], CONTRAST.status),
  });
  const success = finalize(status(variant.terminal.normal.green));
  const warning = finalize(status(variant.terminal.normal.yellow));
  const danger = finalize(status(variant.mError));
  const dangerHover = ensureContrast(
    adjustLightness(danger.fg, dark ? 0.06 : -0.06),
    bg,
    CONTRAST.status,
  );

  const onDanger = onFill(danger.fg, variant.mOnError, bg, text);
  // The accent may be used as text only where it reads everywhere. A
  // borderline accent (a just-visible nudge away) is nudged; otherwise accent
  // text falls back to on-surface and the accent stays a tint (design rule).
  const nudgedAccent = ensureContrastAll(primary, textBgs, CONTRAST.status);
  const accentText =
    textBgs.every((b) => contrastRatio(nudgedAccent, b) >= CONTRAST.status) &&
    oklabDistance(nudgedAccent, primary) <= ACCENT_TEXT_MAX_NUDGE
      ? nudgedAccent
      : text;

  // Translucent state tints. Their alpha is lowered (rarely needed) until
  // text keeps ≥ 4.5:1 and muted text ≥ 3:1 on the tint over every surface.
  const readableOn = (painted: string) =>
    contrastRatio(text, painted) >= CONTRAST.status &&
    contrastRatio(textMuted, painted) >= CONTRAST.faint;
  const tintReadable = (color: string, a: number) =>
    textBgs.every((b) => readableOn(blendOver(color, a, b)));
  const tint = (color: string, alpha: number) => {
    let a = alpha;
    while (a > 0.02 && !tintReadable(color, a)) {
      a -= 0.02;
    }
    return toRgba(color, a);
  };

  const shadow =
    hexToOklab(variant.mShadow).l < 0.35 ? variant.mShadow : "#000000";
  const [sa, ma, la] = SHADOW_ALPHA[mode];

  return {
    "--vault-canvas": canvas,
    "--vault-bg": bg,
    "--vault-surface": surface,
    "--vault-surface-hover": surfaceHover,
    "--vault-surface-active": surfaceActive,
    "--vault-border": border,
    "--vault-border-strong": borderStrong,
    "--vault-menu-bg": menu,
    "--vault-text": text,
    "--vault-text-muted": textMuted,
    "--vault-text-faint": textFaint,
    "--vault-primary": primary,
    // Alias used by notices and plugins (frames, favourites).
    "--vault-accent": primary,
    "--vault-primary-hover": primaryHover,
    "--vault-primary-active": primaryActive,
    "--vault-primary-light": primaryLight,
    "--vault-primary-border": primaryBorder,
    "--vault-on-primary": onPrimary,
    "--vault-on-danger": onDanger,
    "--vault-accent-text": accentText,
    "--vault-success": success.fg,
    "--vault-success-bg": success.bg,
    "--vault-success-border": success.border,
    "--vault-warning": warning.fg,
    "--vault-warning-bg": warning.bg,
    "--vault-warning-border": warning.border,
    "--vault-danger": danger.fg,
    "--vault-danger-bg": danger.bg,
    "--vault-danger-border": danger.border,
    "--vault-danger-hover": dangerHover,
    "--vault-shadow-sm": `0 1px 2px ${toRgba(shadow, sa)}`,
    "--vault-shadow-md": `0 4px 12px ${toRgba(shadow, ma)}`,
    "--vault-shadow-lg": `0 12px 32px ${toRgba(shadow, la)}`,
    // Elevation (borders first): level 1 islands, level 2 popovers/dialogs.
    "--vault-shadow-island": `0 1px 2px ${toRgba(shadow, 0.14)}`,
    "--vault-shadow-pop": `0 8px 24px ${toRgba(shadow, 0.26)}`,
    "--vault-scrim": toRgba(shadow, STATE_ALPHA.scrim),
    "--vault-hover": tint(text, STATE_ALPHA.hover[mode]),
    "--vault-chip": tint(text, STATE_ALPHA.chip),
    "--vault-chip-strong": tint(text, STATE_ALPHA.chipStrong),
    "--vault-sel": tint(primary, STATE_ALPHA.selected),
    "--vault-sel-strong": tint(primary, STATE_ALPHA.selectedStrong),
    "--vault-ring": `0 0 0 2px ${bg}, 0 0 0 4px ${toRgba(
      primary,
      STATE_ALPHA.ring,
    )}`,
    ...markdownTokens(variant),
    // Same ring drawn inside, for rows and tabs whose parent clips overflow.
    "--vault-ring-inset": `inset 0 0 0 2px ${toRgba(
      primary,
      STATE_ALPHA.ring,
    )}`,
  };
};
