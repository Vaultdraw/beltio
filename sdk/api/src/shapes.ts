import type { Disposable } from "./disposable";
import type { Json } from "./storage";

/**
 * How a custom shape draws itself.
 *
 * @since 0.16.0
 */
export interface ShapeDef {
  /**
   * Returns the shape as one SVG document (`<svg ...>...</svg>`, at most 200 KiB). It is drawn as
   * an image, so it never runs script, and the picture stays in the drawing: the file opens
   * without the plugin and shows the last picture.
   *
   * @since 0.16.0
   */
  render(props: Json, size: { width: number; height: number }): string;
  /**
   * The props a new shape starts with. Default: an empty object.
   *
   * @since 0.16.0
   */
  defaults?: Json;
}

/**
 * Custom shapes: declared in plugin.toml (`[[contributes.shapes]]`); the app adds the palette
 * command "Insert shape: <title>" and a toolbar button for each. A shape is a normal image element
 * whose picture comes from `render`, with the shape name and its props stored as the plugin's
 * element data (at most 4 KiB), so the plugin can draw it again after the props change.
 *
 * @since 0.16.0
 */
export interface ShapesApi {
  /**
   * Provides how a declared shape draws. The plugin loads when its insert command first runs.
   *
   * @since 0.16.0
   */
  register(id: string, def: ShapeDef): Disposable;
  /**
   * Adds a shape to the open drawing in one undo step and resolves to its element id. Default
   * position: the middle of the view; default size: the declared `width` and `height`.
   *
   * @since 0.16.0
   */
  insert(
    id: string,
    props?: Json,
    at?: { x?: number; y?: number; width?: number; height?: number },
  ): Promise<string>;
  /**
   * Draws a shape of this plugin again with new props, in place and in one undo step. The element
   * is replaced, so it gets a new id, which this resolves to.
   *
   * @since 0.16.0
   */
  update(elementId: string, props: Json): Promise<string>;
}
