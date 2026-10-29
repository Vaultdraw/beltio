/**
 * The theme's Markdown tokens (`markdown.h1` … `markdown.h6`, like
 * Obsidian's `--h1-color`): what the canvas draws a text with a heading role
 * in. Derived from the theme's accents and terminal colours, each held to at
 * least 4.5:1 on the canvas actually shown. Themes defining their own tokens
 * is a follow-up shared with the Markdown import styling (one interface:
 * `markdownTokens`).
 */
import { ensureContrast } from "../theme/color";

import { HEADING_ROLES } from "./roles";

import type { ThemeVariant } from "../theme/types";
import type { HeadingRole } from "./roles";

export const MIN_ROLE_CONTRAST = 4.5;

export type MarkdownTokens = Record<HeadingRole, string>;

export const markdownTokens = (variant: ThemeVariant): MarkdownTokens => ({
  h1: variant.mPrimary,
  h2: variant.mSecondary,
  h3: variant.mTertiary,
  h4: variant.terminal.normal.blue,
  h5: variant.terminal.normal.magenta,
  h6: variant.terminal.normal.cyan,
});

/** role -> on-screen colour on `canvas`, or null for roles without a token. */
export function buildRoleColor(
  variant: ThemeVariant,
  canvas: string,
): (role: string) => string | null {
  const tokens = markdownTokens(variant);
  const out = new Map<string, string>();
  for (const role of HEADING_ROLES) {
    out.set(role, ensureContrast(tokens[role], canvas, MIN_ROLE_CONTRAST));
  }
  return (role) => out.get(role) ?? null;
}
