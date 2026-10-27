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
}

export type RoleTable = Readonly<Record<RoleName, Role>>;

const HEADING_SCALE = [2, 1.5, 1.25, 1.125, 1, 1];

const role = (name: RoleName, family: FontFamilyName, size: number): Role => {
  const lineHeight = LINE_HEIGHTS[family];
  return { name, family, size, lineHeight, linePx: size * lineHeight };
};

/** The roles for a body size and three families. Sizes are rounded to 0.5 px. */
export const fontPlan = (fonts: LayoutFonts, fontSize: number): RoleTable => {
  const half = (n: number) => Math.round(n * 2) / 2;
  return {
    body: role("body", fonts.body, fontSize),
    h1: role("h1", fonts.heading, half(fontSize * HEADING_SCALE[0])),
    h2: role("h2", fonts.heading, half(fontSize * HEADING_SCALE[1])),
    h3: role("h3", fonts.heading, half(fontSize * HEADING_SCALE[2])),
    h4: role("h4", fonts.heading, half(fontSize * HEADING_SCALE[3])),
    h5: role("h5", fonts.heading, half(fontSize * HEADING_SCALE[4])),
    h6: role("h6", fonts.heading, half(fontSize * HEADING_SCALE[5])),
    title: role("title", fonts.heading, fontSize),
    code: role("code", fonts.code, half(fontSize * 0.875)),
  };
};

export const headingRole = (level: number): RoleName =>
  `h${Math.min(6, Math.max(1, level))}` as RoleName;

/** The font string `wrapText` is given; the width table is keyed by it. */
export const fontKey = (family: string, size: number) => `${size}px ${family}`;
