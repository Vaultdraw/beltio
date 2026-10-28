import type { Disposable } from "./disposable";

/**
 * What to draw: TeX source, display or inline style, and the colour of the glyphs.
 *
 * @since 0.24.0
 */
export interface MathRequest {
  /** TeX source without delimiters, at most 20,000 characters. @since 0.24.0 */
  source: string;
  /** True for display style (`$$ ... $$`), false for inline. @since 0.24.0 */
  display: boolean;
  /** A CSS colour: `#rgb`, `#rrggbb` or a plain name. @since 0.24.0 */
  color: string;
}

/**
 * A rendered formula: one SVG document with its natural size in pixels, or the TeX error.
 *
 * @since 0.24.0
 */
export type MathResult =
  | { ok: true; svg: string; width: number; height: number }
  | { ok: false; error: string };

/**
 * The TeX renderer. One plugin provides it (the official `formula` plugin); the app's notes view
 * and other plugins call it. Nothing is loaded until the first render.
 *
 * @since 0.24.0
 */
export interface MathApi {
  /**
   * Renders TeX to SVG. Resolves to `null` when no plugin provides a renderer (the formula plugin
   * is off): show the TeX source instead.
   *
   * @since 0.24.0
   */
  render(request: MathRequest): Promise<MathResult | null>;
  /**
   * Makes this plugin the renderer behind `render`. The latest provider wins; disposing it (or
   * the plugin stopping) removes it.
   *
   * @since 0.24.0
   */
  provide(renderer: (request: MathRequest) => Promise<MathResult>): Disposable;
}
