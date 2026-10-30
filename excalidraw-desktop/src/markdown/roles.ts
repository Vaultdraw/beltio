/**
 * Markdown roles of text elements: the element stores its role in
 * `customData.role` and keeps its normal text colour, so the file reads the
 * same on excalidraw.com; the canvas draws each role in the active theme's
 * colour for it (see roleColors.ts). Shared with the Markdown import styling.
 */
import type { ExcalidrawTextElement } from "@excalidraw/element/types";

export const HEADING_ROLES = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;
export type HeadingRole = typeof HEADING_ROLES[number];
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

/** A quote box (`> `): drawn in the theme's quote colour. */
export const QUOTE_ROLE = "quote";

/** Roles a whole text box takes (Enter after them starts a new box). */
export const isBoxRole = (role: unknown): boolean =>
  role === QUOTE_ROLE || headingLevelOf(role) !== null;

export const headingRole = (level: HeadingLevel): HeadingRole =>
  HEADING_ROLES[level - 1];

/** The heading level of a role, or null for any other role (or none). */
export const headingLevelOf = (role: unknown): HeadingLevel | null => {
  const i = (HEADING_ROLES as readonly unknown[]).indexOf(role);
  return i < 0 ? null : ((i + 1) as HeadingLevel);
};

export const roleOf = (
  element: Pick<ExcalidrawTextElement, "customData"> | null | undefined,
): string | null => {
  const role = element?.customData?.role;
  return typeof role === "string" ? role : null;
};

/** The two stock text colours: a text in one of them has no colour of its own. */
const STOCK_TEXT_COLORS = ["#1e1e1e", "#000000"];

/**
 * customData with `role` set (or removed when null); undefined when nothing is left.
 *
 * `base` is the text colour the box had when the role was set. A user's own
 * text default colour is no reason to lose the theme's role colour (the
 * theme owns heading and quote colours, like Obsidian's `--h1-color`), so
 * the role colour applies while the stored colour is still `roleBase`; a
 * colour picked afterwards differs and wins.
 */
export const withRole = (
  customData: Record<string, unknown> | undefined,
  role: string | null,
  base?: string,
): Record<string, unknown> | undefined => {
  const { role: _old, roleBase: _oldBase, ...rest } = customData ?? {};
  const own =
    base && !STOCK_TEXT_COLORS.includes(base.toLowerCase())
      ? { roleBase: base.toLowerCase() }
      : {};
  const next = role ? { ...rest, role, ...own } : rest;
  return Object.keys(next).length ? next : undefined;
};
