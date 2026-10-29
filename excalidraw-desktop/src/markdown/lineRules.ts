/**
 * Markdown typing rules for one line, pure. Called on a typed space with the
 * text between the line start and the caret, never with the whole text.
 */
import type { HeadingLevel } from "./roles";

/** The block a typed space turns the line into, or null. */
export type LineTrigger = { kind: "heading"; level: HeadingLevel };

/**
 * `before` is the line's text before the caret, without the space being
 * typed. `#` to `######` makes a heading of that level. Leading spaces are
 * not allowed (as in Markdown, where 4 spaces make code; we keep it strict).
 */
export function matchLineTrigger(before: string): LineTrigger | null {
  const n = before.length;
  if (n < 1 || n > 6) {
    return null;
  }
  for (let i = 0; i < n; i++) {
    if (before.charCodeAt(i) !== 35 /* # */) {
      return null;
    }
  }
  return { kind: "heading", level: n as HeadingLevel };
}

/** Start index of the caret's line in `value`. */
export const lineStart = (value: string, caret: number): number =>
  value.lastIndexOf("\n", caret - 1) + 1;

/** End index (exclusive) of the line that starts at or before `from`. */
export const lineEnd = (value: string, from: number): number => {
  const i = value.indexOf("\n", from);
  return i < 0 ? value.length : i;
};

/** Default heading sizes, as multiples of the body text size (as the Markdown import). */
export const DEFAULT_HEADING_SCALES: readonly number[] = [
  2, 1.5, 1.25, 1.125, 1, 1,
];

/** Gap between a block and the next one, in body lines. */
export const DEFAULT_BLOCK_GAP = 0.5;
