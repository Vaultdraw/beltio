/**
 * Inline marks of a whole text box, typed in Markdown mode (Obsidian's live
 * preview, one font per box): a box that is entirely `**bold**` or
 * `` `code` `` turns into that look the moment the closing mark is typed, and
 * the marks go (the way the Markdown import draws a note's all-bold paragraph).
 * Pure functions; the editor extension calls them on a `*` or backtick only.
 */
import { FONT_FAMILY, boldFontOf, regularFontOf } from "@excalidraw/common";

export type InlineKind = "bold" | "code";

export type InlineMatch = { kind: InlineKind; inner: string };

// inner text: no mark character, no space at either end, at least one character
const BOLD = /^\*\*([^*\s](?:[^*]*[^*\s])?)\*$/;
const CODE = /^`([^`\s](?:[^`]*[^`\s])?)$/;

/**
 * What typing `key` at the end of `value` completes: `**text*` + `*` is bold,
 * `` `text `` + backtick is code. Null when the box is anything else (more
 * text around it, an unmatched mark, a space inside the marks, nested marks).
 */
export const matchClosingMark = (
  value: string,
  key: string,
): InlineMatch | null => {
  const m =
    key === "*" ? BOLD.exec(value) : key === "`" ? CODE.exec(value) : null;
  return m ? { kind: key === "*" ? "bold" : "code", inner: m[1] } : null;
};

/** The font a box takes for `kind` (bold: the bold variant of its family; code: Cascadia). */
export const inlineFont = (fontFamily: number, kind: InlineKind): number =>
  kind === "bold" ? boldFontOf(fontFamily) : FONT_FAMILY.Cascadia;

/** Bold <-> regular for the toggle command. */
export const toggledBoldFont = (fontFamily: number): number =>
  boldFontOf(fontFamily) === fontFamily
    ? regularFontOf(fontFamily)
    : boldFontOf(fontFamily);
