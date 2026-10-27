import type { Disposable } from "./disposable";

/**
 * A pointer position while a plugin tool is active.
 *
 * @since 0.15.0
 */
export interface ToolPoint {
  /** Scene coordinates. @since 0.15.0 */
  x: number;
  /** @since 0.15.0 */
  y: number;
  /** @since 0.15.0 */
  shiftKey: boolean;
  /** @since 0.15.0 */
  altKey: boolean;
  /** Control or Command. @since 0.15.0 */
  modKey: boolean;
}

/**
 * What a canvas tool does with the pointer. Draw with `ctx.scene.batch`.
 *
 * @since 0.15.0
 */
export interface ToolHandlers {
  /** The pointer went down on the canvas. @since 0.15.0 */
  pointerDown?(point: ToolPoint): void | Promise<void>;
  /** The pointer moved while down; at most once per frame. @since 0.15.0 */
  pointerMove?(point: ToolPoint): void;
  /** The pointer went up. @since 0.15.0 */
  pointerUp?(point: ToolPoint): void | Promise<void>;
  /** The gesture was cut short (another tool was chosen, Escape, the drawing closed). @since 0.15.0 */
  cancel?(): void;
}

/**
 * Canvas tools: declared in plugin.toml (`[[contributes.tools]]`); the app adds a palette
 * command ("Tool: <title>") and a toolbar button for each. Register the handlers in `activate()`.
 *
 * @since 0.15.0
 */
export interface ToolsApi {
  /**
   * Provides the handlers of a declared tool. The plugin loads when the tool is first chosen.
   *
   * @since 0.15.0
   */
  register(id: string, handlers: ToolHandlers): Disposable;
}
