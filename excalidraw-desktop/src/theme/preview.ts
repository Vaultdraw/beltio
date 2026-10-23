/**
 * Theme previews: the few colours a theme card needs, per mode.
 *
 * Built-in previews are precomputed into builtin-index.json (packed as one
 * string per mode) so pickers never load or parse a theme file.
 */

import type { ResolvedTheme, ThemeVariant } from "./types";

/** Colours a theme card needs, per mode (lowercase `#rrggbb`). */
export interface ThemePreviewColors {
  surface: string;
  onSurface: string;
  surfaceVariant: string;
  onSurfaceVariant: string;
  outline: string;
  primary: string;
  terminal: { red: string; yellow: string; green: string; blue: string };
}

export interface ThemePreview {
  dark: ThemePreviewColors;
  light: ThemePreviewColors;
  /** True for a mode the file doesn't provide (generated from the other). */
  generated: { dark: boolean; light: boolean };
}

/** Preview colours of a resolved variant. */
export const previewFromVariant = (v: ThemeVariant): ThemePreviewColors => ({
  surface: v.mSurface,
  onSurface: v.mOnSurface,
  surfaceVariant: v.mSurfaceVariant,
  onSurfaceVariant: v.mOnSurfaceVariant,
  outline: v.mOutline,
  primary: v.mPrimary,
  terminal: {
    red: v.terminal.normal.red,
    yellow: v.terminal.normal.yellow,
    green: v.terminal.normal.green,
    blue: v.terminal.normal.blue,
  },
});

export const previewFromTheme = (theme: ResolvedTheme): ThemePreview => ({
  dark: previewFromVariant(theme.dark),
  light: previewFromVariant(theme.light),
  generated: { ...theme.generated },
});

/** Packed form: 10 hex colours without `#`, comma-separated. */
export const packPreviewColors = (c: ThemePreviewColors): string =>
  [
    c.surface,
    c.onSurface,
    c.surfaceVariant,
    c.onSurfaceVariant,
    c.outline,
    c.primary,
    c.terminal.red,
    c.terminal.yellow,
    c.terminal.green,
    c.terminal.blue,
  ]
    .map((hex) => hex.replace(/^#/, ""))
    .join(",");

export const unpackPreviewColors = (packed: string): ThemePreviewColors => {
  const [
    surface,
    onSurface,
    surfaceVariant,
    onSurfaceVariant,
    outline,
    primary,
    red,
    yellow,
    green,
    blue,
  ] = packed.split(",").map((hex) => `#${hex}`);
  return {
    surface,
    onSurface,
    surfaceVariant,
    onSurfaceVariant,
    outline,
    primary,
    terminal: { red, yellow, green, blue },
  };
};
