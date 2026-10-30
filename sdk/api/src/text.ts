/**
 * `ctx.text` and `ctx.fonts`: measure text exactly as the editor does, after
 * making sure the font is loaded. A plugin that lays out text itself (an
 * importer wrapping lines in a worker) uses these so the editor never
 * re-wraps its result.
 */
import type { FontFamilyName } from "./scene";

/**
 * A font as text elements use it.
 *
 * @since 0.8.0
 */
export interface TextFont {
  /** @since 0.8.0 */
  family: FontFamilyName;
  /** Size in scene pixels, 1 to 1000. @since 0.8.0 */
  size: number;
  /**
   * The bold variant of the family (the font id a bold text stores). Widths
   * differ from the regular ones, so measure with the flag a text is drawn
   * with. Lilita One is heavy already and ignores it.
   *
   * @since 0.36.0
   */
  bold?: boolean;
}

/**
 * Text measuring with the editor's own measure (canvas `measureText`).
 *
 * @since 0.8.0
 */
export interface TextApi {
  /**
   * The width of each string on one line, in scene pixels, in order. At
   * most 100,000 strings and 4,000,000 characters per call. Load the font
   * first with `ctx.fonts.ensure`, or the widths are the fallback font's.
   * To build a width table for a worker, measure each character once and
   * transfer the result.
   *
   * @since 0.8.0
   */
  measure(font: TextFont, strings: readonly string[]): Float64Array;
  /**
   * The line height the editor uses for a family, as a multiple of the font
   * size (a line is `size * lineHeight` pixels tall).
   *
   * @since 0.8.0
   */
  lineHeight(family: FontFamilyName): number;
  /**
   * Folds text the way the app's search does: lower case, accents and the
   * usual look-alikes removed (`Éclair` and `STRASSE` become `eclair` and
   * `strasse`; `ß` becomes `ss`). Compare folded strings to match names the
   * way the quick switcher and the vault search do. Synchronous, at most
   * 4,000,000 characters.
   *
   * @experimental Outside the 1.0 promise: it may change or go in a minor release.
   * @since 1.2.0
   */
  fold(text: string): string;
}

/**
 * Font loading.
 *
 * @since 0.8.0
 */
export interface FontsApi {
  /**
   * Loads the families (and, for fonts split by script, the parts that
   * cover `text`, by default printable ASCII). Resolves when they are ready;
   * fails with `FONT_UNAVAILABLE` after 10 seconds.
   *
   * @since 0.8.0
   */
  ensure(families: readonly FontFamilyName[], text?: string): Promise<void>;
}
