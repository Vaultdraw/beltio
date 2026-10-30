import { ROLE_COLOR_PICKED } from "./colors";
import { FONT_FAMILY, boldFontOf } from "./constants";

/**
 * The `customData` patch a font change spreads into its update: a text with the "code" role is
 * code only while it is in the code font, so the role (and the theme's code colour) ends when the
 * font is changed to another one (toimprove 264; Obsidian: the colour belongs to the code).
 * Empty when nothing changes.
 */
export const roleAfterFontChange = (
  element: { type: string; customData?: Record<string, unknown> | null },
  fontFamily: number,
): { customData?: Record<string, unknown> } => {
  const data = element.customData;
  if (
    element.type !== "text" ||
    data?.role !== "code" ||
    fontFamily === FONT_FAMILY.Cascadia ||
    fontFamily === boldFontOf(FONT_FAMILY.Cascadia)
  ) {
    return {};
  }
  const { role: _r, roleBase: _b, [ROLE_COLOR_PICKED]: _p, ...rest } = data;
  return { customData: rest };
};
