/**
 * Markdown colours of a theme, like an Obsidian theme's `--h1-color` …
 * `--h6-color`, `--bold-color`, `--link-color`, `--code-normal`,
 * `--code-background` and `--blockquote-border-color`.
 *
 * A theme sets them per variant in a `markdown` block:
 *
 * ```json
 * "dark": { "mPrimary": "#89b4fa", …, "markdown": { "h1": "#f38ba8", "link": "#89b4fa" } }
 * ```
 *
 * Any it leaves out come from the theme's own colours, as Obsidian's default
 * theme falls back to `--text-normal` and `--text-accent`: headings from the
 * accent (primary), then secondary and tertiary accents, then the accents
 * mixed towards the text, the last level the muted text; links and the quote
 * bar the accent; bold, italic and code the text. Derived text colours read at
 * ≥ 4.5:1 on the page (the quote bar ≥ 3:1). Colours the theme sets are its
 * author's choice and are used as written.
 */
import { MARKDOWN_ROLES } from "../../../sdk/api/shared/markdownRoles";

import { ensureContrast, mix, normalizeHex } from "./color";

import type { MarkdownRole } from "../../../sdk/api/shared/markdownRoles";
import type { ThemeVariant } from "./types";

export { MARKDOWN_ROLES };
export type { MarkdownRole };

export type MarkdownColors = Record<MarkdownRole, string>;

/** Contrast of derived Markdown text colours on the page. */
export const MARKDOWN_TEXT_CONTRAST = 4.5;
/** Contrast of the derived quote bar (a graphic, not text). */
export const MARKDOWN_BAR_CONTRAST = 3;

/** The token name of a role: `--vault-md-h1`, `--vault-md-code-bg`. */
export const markdownToken = (role: MarkdownRole) =>
  `--vault-md-${role.replace(/_/g, "-")}` as const;

/** Reads a theme file's `markdown` block: known roles with valid colours; the rest are warnings. */
export const readMarkdownInput = (
  raw: unknown,
  path: string,
  warnings: string[],
): Partial<MarkdownColors> | undefined => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    warnings.push(`${path} must be an object of colours; ignored`);
    return undefined;
  }
  const out: Partial<MarkdownColors> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!(MARKDOWN_ROLES as readonly string[]).includes(key)) {
      warnings.push(`${path}.${key}: unknown key ignored`);
      continue;
    }
    const hex = typeof value === "string" ? normalizeHex(value) : null;
    if (!hex) {
      warnings.push(`${path}.${key} must be a hex colour; ignored`);
      continue;
    }
    out[key as MarkdownRole] = hex;
  }
  return out;
};

/** The colours a theme gets for the roles it does not set, from its own palette. */
export const deriveMarkdownColors = (v: ThemeVariant): MarkdownColors => {
  const page = v.mSurface;
  const text = v.mOnSurface;
  const read = (c: string) => ensureContrast(c, page, MARKDOWN_TEXT_CONTRAST);
  return {
    h1: read(v.mPrimary),
    h2: read(v.mSecondary),
    h3: read(v.mTertiary),
    h4: read(mix(v.mPrimary, text, 0.4)),
    h5: read(mix(v.mSecondary, text, 0.4)),
    h6: read(v.mOnSurfaceVariant),
    bold: read(text),
    italic: read(text),
    link: read(v.mPrimary),
    code: read(text),
    code_bg: mix(page, text, 0.08),
    quote_bar: ensureContrast(v.mPrimary, page, MARKDOWN_BAR_CONTRAST),
  };
};

const cache = new WeakMap<ThemeVariant, MarkdownColors>();

/** Every Markdown colour of a variant: the theme's own, derived where it sets none. */
export const markdownColors = (v: ThemeVariant): MarkdownColors => {
  let hit = cache.get(v);
  if (!hit) {
    hit = { ...deriveMarkdownColors(v), ...(v.markdown ?? {}) };
    cache.set(v, hit);
  }
  return hit;
};
