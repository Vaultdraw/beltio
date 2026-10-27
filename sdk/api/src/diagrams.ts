import type { SceneOp } from "./scene";

/**
 * A Mermaid diagram turned into drawing elements.
 *
 * @since 0.23.0
 */
export interface MermaidDrawing {
  /**
   * `add` ops for `ctx.scene.batch` or `ctx.vault.createDrawing`. Shapes and text come with
   * their labels, arrows between shapes are bound (`start`/`end` refs). The top left of the
   * diagram is at 0, 0.
   *
   * @since 0.23.0
   */
  ops: SceneOp[];
  /** Size of the diagram in scene units. @since 0.23.0 */
  width: number;
  /** @since 0.23.0 */
  height: number;
  /** Elements the ops leave out (pictures some diagram types use). @since 0.23.0 */
  skipped: number;
}

/**
 * Diagram converters of the app. The converter code is not part of the app's startup: it loads
 * on the first call, and only while the user has not turned Mermaid off.
 *
 * @since 0.23.0
 */
export interface DiagramsApi {
  /**
   * Converts Mermaid text with the editor's own Mermaid-to-Excalidraw converter. Rejects with
   * the converter's message when the text is not a Mermaid diagram it understands.
   *
   * @since 0.23.0
   */
  mermaidToElements(text: string): Promise<MermaidDrawing>;
}
