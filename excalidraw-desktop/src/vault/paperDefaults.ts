/**
 * The app's default paper (notebook background) for new drawings: the
 * `paper*` preferences <-> a BackgroundPattern, plus the effective default
 * (a vault's settings.toml may override the style).
 */
import {
  createBackgroundPattern,
  normalizeBackgroundPattern,
  type BackgroundPattern,
} from "@excalidraw/excalidraw/data/backgroundPattern";

import { getPreferences, updatePreferences } from "./preferences";
import { getVaultSettingsSnapshot, resolveSetting } from "./vaultSettings";

import type { VaultPreferences } from "./preferences";

export type PaperPrefs = Pick<
  VaultPreferences,
  | "paperStyle"
  | "paperSpacing"
  | "paperColor"
  | "paperOpacity"
  | "paperMajorEvery"
  | "paperMarginLine"
>;

/** "plain" gives null; 0 spacing / major-every and "" colour mean preset / automatic. */
export function patternFromPaperPrefs(
  prefs: PaperPrefs,
): BackgroundPattern | null {
  if (prefs.paperStyle === "plain") {
    return null;
  }
  return createBackgroundPattern(prefs.paperStyle, {
    ...(prefs.paperSpacing > 0 && { spacing: prefs.paperSpacing }),
    ...(prefs.paperMajorEvery > 0 && { majorEvery: prefs.paperMajorEvery }),
    color: prefs.paperColor || null,
    opacity: prefs.paperOpacity,
    marginLine: prefs.paperMarginLine,
  });
}

/** Inverse of patternFromPaperPrefs; stores explicit numbers. */
export function paperPrefsFromPattern(
  pattern: BackgroundPattern | null,
): PaperPrefs {
  const p = normalizeBackgroundPattern(pattern);
  if (!p) {
    return {
      paperStyle: "plain",
      paperSpacing: 0,
      paperColor: "",
      paperOpacity: 1,
      paperMajorEvery: 0,
      paperMarginLine: true,
    };
  }
  return {
    paperStyle: p.type,
    paperSpacing: p.spacing,
    paperColor: p.color ?? "",
    paperOpacity: p.opacity,
    paperMajorEvery: p.majorEvery,
    paperMarginLine: p.marginLine,
  };
}

/**
 * The pattern new drawings start with: the global paper preferences with the
 * open vault's style override applied. A vault style that differs from the
 * global one starts from its own preset spacing and major lines.
 */
export function patternForNewDrawing(
  prefs: PaperPrefs,
  paperStyle: PaperPrefs["paperStyle"],
): BackgroundPattern | null {
  return patternFromPaperPrefs(
    paperStyle === prefs.paperStyle
      ? prefs
      : { ...prefs, paperStyle, paperSpacing: 0, paperMajorEvery: 0 },
  );
}

export function getDefaultBackgroundPattern(
  win?: Window | null,
): BackgroundPattern | null {
  const prefs = getPreferences(win);
  return patternForNewDrawing(
    prefs,
    resolveSetting("paperStyle", getVaultSettingsSnapshot().overrides, prefs),
  );
}

/** Makes `pattern` the global default (null = plain). */
export function setDefaultBackgroundPattern(
  pattern: BackgroundPattern | null,
  win?: Window | null,
): void {
  updatePreferences(paperPrefsFromPattern(pattern), win);
}
