/**
 * The state of a drawing's thumbnail.
 *
 * @experimental Outside the 1.0 promise: it may change or go in a minor release.
 *
 * @since 0.20.0
 */
export interface ThumbnailState {
  /** `none` when thumbnails are off or the drawing has none. @since 0.20.0 */
  status: "loading" | "ready" | "none";
  /** An image URL while `ready`. @since 0.20.0 */
  url: string | null;
}

/**
 * Drawing previews, from the app's one thumbnail service (its cache and render queue are shared,
 * so a plugin adds no memory of its own). These are React hooks: call them while rendering a
 * component the plugin gave the app (a view, an overlay).
 *
 * @experimental Outside the 1.0 promise: it may change or go in a minor release.
 *
 * @since 0.20.0
 */
export interface ThumbnailsApi {
  /**
   * The thumbnail state of `path` (null: none). `near` renders after `visible` ones.
   *
   * @since 0.20.0
   */
  use(path: string | null, priority?: "visible" | "near"): ThumbnailState;
  /** False when the user turned thumbnails off: show names only. @since 0.20.0 */
  useEnabled(): boolean;
  /** A class for the container of thumbnail images (dark themes). @since 0.20.0 */
  useDarkClass(): string;
}
