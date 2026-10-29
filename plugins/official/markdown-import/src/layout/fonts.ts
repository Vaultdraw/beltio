/**
 * Font roles: which family and size each kind of text uses, and the editor's
 * line height for it. Everything scales from the body size so one setting
 * (`font_size`) sizes the whole note.
 */
import { LINE_HEIGHTS } from "../../../../../sdk/api/shared/text";

import type { FontFamilyName, LayoutFonts } from "./types";

export type RoleName =
  | "body"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "title"
  | "code";

export interface Role {
  name: RoleName;
  family: FontFamilyName;
  /** Scene pixels. */
  size: number;
  /** Multiple of `size`, as the editor draws it. */
  lineHeight: number;
  /** `size * lineHeight`. */
  linePx: number;
  /** The bold variant of the family (headings; the `heading_bold` setting). */
  bold: boolean;
}

export type RoleTable = Readonly<Record<RoleName, Role>>;

/**
 * Heading sizes as a multiple of the body size: Obsidian's default theme
 * steps (1.8, 1.6, 1.4, 1.25, 1.125, 1). Headings are in the bold variant of
 * the font (`heading_bold`), and size and the heading colour carry the level.
 */
const HEADING_SCALE = [1.8, 1.6, 1.4, 1.25, 1.125, 1];

const role = (
  name: RoleName,
  family: FontFamilyName,
  size: number,
  bold = false,
): Role => {
  const lineHeight = LINE_HEIGHTS[family];
  return { name, family, size, lineHeight, linePx: size * lineHeight, bold };
};

/** The roles for a body size and three families. Sizes are rounded to 0.5 px. */
export const fontPlan = (
  fonts: LayoutFonts,
  fontSize: number,
  boldHeadings = true,
): RoleTable => {
  const half = (n: number) => Math.round(n * 2) / 2;
  const heading = (name: RoleName, scale: number) =>
    role(name, fonts.heading, half(fontSize * scale), boldHeadings);
  return {
    body: role("body", fonts.body, fontSize),
    h1: heading("h1", HEADING_SCALE[0]),
    h2: heading("h2", HEADING_SCALE[1]),
    h3: heading("h3", HEADING_SCALE[2]),
    h4: heading("h4", HEADING_SCALE[3]),
    h5: heading("h5", HEADING_SCALE[4]),
    h6: heading("h6", HEADING_SCALE[5]),
    title: role("title", fonts.heading, fontSize, boldHeadings),
    code: role("code", fonts.code, half(fontSize * 0.875)),
  };
};

export const headingRole = (level: number): RoleName =>
  `h${Math.min(6, Math.max(1, level))}` as RoleName;

/** The font string `wrapText` is given; the width table is keyed by it. */
export const fontKey = (family: string, size: number, bold = false) =>
  `${bold ? "bold " : ""}${size}px ${family}`;
