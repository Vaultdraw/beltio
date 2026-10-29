/**
 * Theme engine types. The on-disk format is Noctalia-compatible: one JSON
 * file with `dark` and/or `light` blocks of 16 semantic `m*` roles plus an
 * optional `terminal` palette.
 */

import type { MarkdownRole } from "../../../sdk/api/shared/markdownRoles";

export type ThemeMode = "light" | "dark";

export const THEME_MODES: readonly ThemeMode[] = ["dark", "light"];

/** The 16 Noctalia semantic roles. */
export const ROLE_KEYS = [
  "mPrimary",
  "mOnPrimary",
  "mSecondary",
  "mOnSecondary",
  "mTertiary",
  "mOnTertiary",
  "mError",
  "mOnError",
  "mSurface",
  "mOnSurface",
  "mSurfaceVariant",
  "mOnSurfaceVariant",
  "mOutline",
  "mShadow",
  "mHover",
  "mOnHover",
] as const;

export type RoleKey = typeof ROLE_KEYS[number];

/** Only these are required per variant; everything else is derived. */
export const REQUIRED_ROLE_KEYS = [
  "mSurface",
  "mOnSurface",
  "mPrimary",
] as const;

export const ANSI_KEYS = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
] as const;

export type AnsiKey = typeof ANSI_KEYS[number];

export type AnsiColors = Record<AnsiKey, string>;

export const TERMINAL_EXTRA_KEYS = [
  "foreground",
  "background",
  "selectionFg",
  "selectionBg",
  "cursorText",
  "cursor",
] as const;

export type TerminalExtraKey = typeof TERMINAL_EXTRA_KEYS[number];

export type TerminalColors = {
  normal: AnsiColors;
  bright: AnsiColors;
} & Record<TerminalExtraKey, string>;

/** A fully resolved variant: every role and terminal colour is a lowercase `#rrggbb`. */
export type ThemeVariant = Record<RoleKey, string> & {
  terminal: TerminalColors;
  /** Markdown colours the theme sets (markdown.ts derives the rest). */
  markdown?: Partial<Record<MarkdownRole, string>>;
};

/** Variant as authored (all optional at the type level; validated at runtime). */
export type ThemeVariantInput = Partial<Record<RoleKey, string>> & {
  markdown?: Partial<Record<MarkdownRole, string>>;
  terminal?: Partial<Record<TerminalExtraKey, string>> & {
    normal?: Partial<AnsiColors>;
    bright?: Partial<AnsiColors>;
  };
};

/** The JSON file shape (Noctalia palette + optional name/author). */
export type ThemeFile = {
  name?: string;
  author?: string;
  dark?: ThemeVariantInput;
  light?: ThemeVariantInput;
};

export type ResolvedTheme = {
  /** Stable slug derived from the name, e.g. "tokyo-night". */
  id: string;
  name: string;
  author?: string;
  dark: ThemeVariant;
  light: ThemeVariant;
  /** True for a mode the file didn't provide (generated from the other). */
  generated: { dark: boolean; light: boolean };
  /** Non-fatal notes: unknown keys ignored, low-contrast pairs, adjusted surfaces. */
  warnings: string[];
};

/** CSS custom properties consumed by the vault shell (VaultShell.css). */
export const TOKEN_NAMES = [
  "--vault-canvas",
  "--vault-bg",
  "--vault-surface",
  "--vault-surface-hover",
  "--vault-surface-active",
  "--vault-border",
  "--vault-border-strong",
  "--vault-menu-bg",
  "--vault-text",
  "--vault-text-muted",
  "--vault-text-faint",
  "--vault-primary",
  "--vault-accent",
  "--vault-primary-hover",
  "--vault-primary-active",
  "--vault-primary-light",
  "--vault-primary-border",
  "--vault-on-primary",
  "--vault-on-danger",
  "--vault-accent-text",
  "--vault-success",
  "--vault-success-bg",
  "--vault-success-border",
  "--vault-warning",
  "--vault-warning-bg",
  "--vault-warning-border",
  "--vault-danger",
  "--vault-danger-bg",
  "--vault-danger-border",
  "--vault-danger-hover",
  "--vault-shadow-sm",
  "--vault-shadow-md",
  "--vault-shadow-lg",
  "--vault-shadow-island",
  "--vault-shadow-pop",
  "--vault-scrim",
  "--vault-hover",
  "--vault-chip",
  "--vault-chip-strong",
  "--vault-sel",
  "--vault-sel-strong",
  "--vault-ring",
  "--vault-ring-inset",
  "--vault-md-h1",
  "--vault-md-h2",
  "--vault-md-h3",
  "--vault-md-h4",
  "--vault-md-h5",
  "--vault-md-h6",
  "--vault-md-bold",
  "--vault-md-italic",
  "--vault-md-link",
  "--vault-md-code",
  "--vault-md-code-bg",
  "--vault-md-quote-bar",
] as const;

export type TokenName = typeof TOKEN_NAMES[number];

export type ThemeTokens = Record<TokenName, string>;
