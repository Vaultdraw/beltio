import type { Disposable } from "./disposable";

/**
 * Options of `ctx.present.start`.
 *
 * @since 0.29.0
 */
export interface PresentOptions {
  /**
   * A colour that fills the canvas for the session; the drawing's own background comes back when
   * it ends. Absent: the drawing's background.
   *
   * @since 0.29.0
   */
  background?: string;
  /**
   * Fill the screen (the native window goes full screen). Default true.
   *
   * @since 0.29.0
   */
  fullscreen?: boolean;
  /**
   * Runs once when the session ends for any reason: `end()`, `dispose()`, the user leaving focus
   * mode (Escape), another drawing opening, or the plugin stopping.
   *
   * @since 0.29.0
   */
  onEnd?(): void;
}

/**
 * A running presentation. `dispose()` ends it, like `end()`.
 *
 * @since 0.29.0
 */
export interface PresentSession extends Disposable {
  /** Ends the session and puts everything back; does nothing when it already ended. @since 0.29.0 */
  end(): void;
  /** True until the session ends. @since 0.29.0 */
  readonly isActive: boolean;
  /** Switches the laser pointer on or off (off returns to the selection tool). @since 0.29.0 */
  setLaser(on: boolean): void;
  /** True while the laser pointer is the active tool. @since 0.29.0 */
  readonly laser: boolean;
}

/**
 * Presenting: the open drawing fills the screen with the app's chrome hidden (the same parts
 * focus mode hides, `[focus] hide`), read-only so a key press never edits it. While a session
 * runs the context key `present.active` is true, so a command can say
 * `when = ["present.active"]` to take keys (arrows, Space) only then. The plugin chooses what is
 * shown, usually with `ctx.scene.fitTo`.
 *
 * @since 0.29.0
 */
export interface PresentApi {
  /**
   * Starts a session on the open drawing and ends the one that was running. Rejects with
   * `NOT_FOUND` when no drawing is open. Call it from a command the user ran.
   *
   * @since 0.29.0
   */
  start(options?: PresentOptions): Promise<PresentSession>;
  /** True while a session of any plugin runs. @since 0.29.0 */
  readonly active: boolean;
}
