import type { Disposable } from "./disposable";

/**
 * Public scene vocabulary shared by plugins, the control API and the CLI
 * bridge. Additive only. Never exposes version, versionNonce, index, seed,
 * bindings or boundElements.
 *
 * @since 0.1.0
 */
export type SceneElementType =
  | "rectangle"
  | "ellipse"
  | "diamond"
  | "text"
  | "arrow"
  | "line"
  | "freedraw"
  | "image"
  | "frame"
  | "other";

/**
 * A read-only view of one element of the active drawing.
 *
 * @since 0.1.0
 */
export interface SceneElement {
  /** @since 0.1.0 */
  readonly id: string;
  /** @since 0.1.0 */
  readonly type: SceneElementType;
  /** @since 0.1.0 */
  readonly x: number;
  /** @since 0.1.0 */
  readonly y: number;
  /** @since 0.1.0 */
  readonly width: number;
  /** @since 0.1.0 */
  readonly height: number;
  /** @since 0.1.0 */
  readonly angle: number;
  /** @since 0.1.0 */
  readonly text?: string;
  /** @since 0.1.0 */
  readonly strokeColor?: string;
  /** @since 0.1.0 */
  readonly backgroundColor?: string;
}

/**
 * An element to add (or the properties to change, minus `type`).
 *
 * @since 0.1.0
 */
export interface NewElement {
  /** @since 0.1.0 */
  type: "rectangle" | "ellipse" | "diamond" | "text" | "arrow" | "line";
  /** @since 0.1.0 */
  x?: number;
  /** @since 0.1.0 */
  y?: number;
  /** @since 0.1.0 */
  width?: number;
  /** @since 0.1.0 */
  height?: number;
  /** @since 0.1.0 */
  text?: string;
  /** @since 0.1.0 */
  fontSize?: number;
  /** @since 0.1.0 */
  strokeColor?: string;
  /** @since 0.1.0 */
  backgroundColor?: string;
  /** @since 0.1.0 */
  strokeWidth?: number;
  /** @since 0.1.0 */
  opacity?: number;
  /** @since 0.1.0 */
  points?: [number, number][];
}

/**
 * One change to the scene; `scene.batch` applies a list as one undo step.
 *
 * @since 0.1.0
 */
export type SceneOp =
  | { op: "add"; element: NewElement }
  | { op: "update"; id: string; props: Partial<Omit<NewElement, "type">> }
  | { op: "delete"; id: string };

/**
 * One problem found while validating a list of ops.
 *
 * @since 0.1.0
 */
export interface SceneOpIssue {
  /**
   * Index in the ops array.
   *
   * @since 0.1.0
   */
  op: number;
  /** @since 0.1.0 */
  key?: string;
  /** @since 0.1.0 */
  message: string;
}

/**
 * Read and change the active drawing.
 *
 * @since 0.1.0
 */
export interface SceneContextApi {
  /**
   * Non-deleted elements of the active drawing (frozen snapshot), [] when none is open.
   *
   * @since 0.1.0
   */
  elements(): readonly SceneElement[];
  /**
   * After the active scene changed ("edit") or another drawing became active
   * ("switch"); at most once per frame.
   *
   * @since 0.1.0
   */
  onChange(
    cb: (e: { reason: "edit" | "switch"; path: string | null }) => void,
  ): Disposable;
  /**
   * React hook: `select(elements)`, re-rendered only when the selected value
   * changes (`isEqual`, default Object.is).
   *
   * @since 0.1.0
   */
  useScene<T>(
    select: (els: readonly SceneElement[]) => T,
    isEqual?: (a: T, b: T) => boolean,
  ): T;
  /**
   * Applies the ops as ONE undo step. Rejects: no drawing, read-only, invalid ops.
   *
   * @since 0.1.0
   */
  batch(ops: readonly SceneOp[]): Promise<{ ids: string[] }>;
  /**
   * Centre of the visible canvas in scene coordinates.
   *
   * @since 0.1.0
   */
  viewportCenter(): { x: number; y: number };
}
