/**
 * The one path from a role to a colour: every text with a role
 * (`customData.role`, typed or imported) is drawn in the active theme's
 * Markdown colour for that role (`markdown.h1` … `markdown.h6`, `bold`,
 * `italic`, `link`, `code`; theme/markdown.ts), like Obsidian's `--h1-color`.
 * A quote's text takes the theme's muted text colour.
 *
 * A theme's own colours are used as written. Only when the canvas shown is
 * not the theme's page ("Sync canvas with theme" off) is a colour moved to
 * read at 4.5:1 on that canvas.
 *
 * A text whose stored colour is neither the editor's default black nor a
 * reserved role colour was picked by the user: it keeps that colour and the
 * role no longer applies.
 */
import { COLOR_PALETTE } from "@excalidraw/common";

import { ROLE_COLORS } from "../../../sdk/api/shared/markdownRoles";
import { ensureContrast, normalizeHex } from "../theme/color";
import { markdownColors } from "../theme/markdown";

import { QUOTE_ROLE } from "./roles";

import type { MarkdownRole } from "../../../sdk/api/shared/markdownRoles";
import type { ThemeVariant } from "../theme/types";

export const MIN_ROLE_CONTRAST = 4.5;

/** Roles a text can have: the theme's Markdown roles and the quote box. */
const TEXT_ROLES: readonly string[] = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "bold",
  "italic",
  "link",
  "code",
];

const DEFAULT_STORED = new Set<string>(
  [COLOR_PALETTE.black, "#1e1e1e", ...Object.values(ROLE_COLORS)].map((c) =>
    String(c).toLowerCase(),
  ),
);

/** The theme's colour of a text role, before any canvas adjustment. */
export const roleTokenColor = (
  variant: ThemeVariant,
  role: string,
): string | null => {
  if (role === QUOTE_ROLE) {
    return variant.mOnSurfaceVariant;
  }
  return TEXT_ROLES.includes(role)
    ? markdownColors(variant)[role as MarkdownRole]
    : null;
};

/** role -> on-screen colour on `canvas`, or null for an unknown role or a colour the user picked. */
export function buildRoleColor(
  variant: ThemeVariant,
  canvas: string,
): (role: string, storedColor?: string) => string | null {
  const onPage = normalizeHex(canvas) === normalizeHex(variant.mSurface);
  const out = new Map<string, string>();
  for (const role of [...TEXT_ROLES, QUOTE_ROLE]) {
    const color = roleTokenColor(variant, role)!;
    out.set(
      role,
      onPage ? color : ensureContrast(color, canvas, MIN_ROLE_CONTRAST),
    );
  }
  return (role, storedColor) =>
    storedColor !== undefined && !DEFAULT_STORED.has(storedColor.toLowerCase())
      ? null
      : out.get(role) ?? null;
}
