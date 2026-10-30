/**
 * The one path from a role to a colour: every text with a role
 * (`customData.role`, typed or imported) is drawn in the active theme's
 * Markdown colour for that role (`markdown.h1` … `markdown.h6`, `bold`,
 * `italic`, `link`, `code`; theme/markdown.ts), like Obsidian's `--h1-color`.
 * A quote's text takes the colour a Markdown import's quote gets: the theme's
 * muted grey (the same on both paths).
 *
 * A theme's own colours are used as written. Only when the canvas shown is
 * not the theme's page ("Sync canvas with theme" off) is a colour moved to
 * read at 4.5:1 on that canvas.
 *
 * A text whose stored colour is neither the editor's default black, a
 * reserved role colour nor the colour its box had when Markdown mode gave it
 * the role (`customData.roleBase`, the user's own text default) was picked by
 * the user afterwards: it keeps that colour and the role no longer applies.
 */
import { COLOR_PALETTE } from "@excalidraw/common";

import { ROLE_COLORS } from "../../../sdk/api/shared/markdownRoles";
import { buildCanvasPaletteMap } from "../theme/canvas";
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

/** The colour a Markdown import draws a quote's text in (its muted tone, gray 600), as the theme paints it. */
const IMPORT_MUTED = "#868e96";
const mutedCache = new WeakMap<ThemeVariant, string>();
const quoteColor = (variant: ThemeVariant): string => {
  let hit = mutedCache.get(variant);
  if (!hit) {
    hit =
      buildCanvasPaletteMap(variant).get(IMPORT_MUTED) ??
      variant.mOnSurfaceVariant;
    mutedCache.set(variant, hit);
  }
  return hit;
};

/** The theme's colour of a text role, before any canvas adjustment. */
export const roleTokenColor = (
  variant: ThemeVariant,
  role: string,
): string | null => {
  if (role === QUOTE_ROLE) {
    return quoteColor(variant);
  }
  return TEXT_ROLES.includes(role)
    ? markdownColors(variant)[role as MarkdownRole]
    : null;
};

/** role -> on-screen colour on `canvas`, or null for an unknown role or a colour the user picked. */
export function buildRoleColor(
  variant: ThemeVariant,
  canvas: string,
): (role: string, storedColor?: string, roleBase?: string) => string | null {
  const onPage = normalizeHex(canvas) === normalizeHex(variant.mSurface);
  const out = new Map<string, string>();
  for (const role of [...TEXT_ROLES, QUOTE_ROLE]) {
    const color = roleTokenColor(variant, role)!;
    out.set(
      role,
      onPage ? color : ensureContrast(color, canvas, MIN_ROLE_CONTRAST),
    );
  }
  return (role, storedColor, roleBase) => {
    if (storedColor !== undefined) {
      const stored = storedColor.toLowerCase();
      if (!DEFAULT_STORED.has(stored) && stored !== roleBase?.toLowerCase()) {
        return null;
      }
    }
    return out.get(role) ?? null;
  };
}
