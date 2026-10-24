import type { Disposable } from "./disposable";
import type { Json } from "./storage";

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
  /**
   * Rotation in radians, -2π to 2π.
   *
   * @since 0.4.0
   */
  angle?: number;
  /** @since 0.4.0 */
  strokeStyle?: "solid" | "dashed" | "dotted";
  /** @since 0.4.0 */
  fillStyle?: "hachure" | "cross-hatch" | "solid" | "zigzag";
  /**
   * Rounded corners or ends. Not on text.
   *
   * @since 0.4.0
   */
  roundness?: "sharp" | "round";
  /**
   * The font of a text element, or of a shape's label.
   *
   * @since 0.4.0
   */
  fontFamily?: FontFamilyName;
  /**
   * A link opened from the element; null removes it. `javascript:`, `data:`,
   * `vbscript:` and `file:` links are refused.
   *
   * @since 0.4.0
   */
  link?: string | null;
  /** @since 0.4.0 */
  locked?: boolean;
  /**
   * This plugin's own data on the element (at most 4 KiB as JSON), stored in
   * the drawing under the plugin's data key (`ctx.manifest.dataKey`). Read it
   * back with `scene.dataOf(id)`. null removes it.
   *
   * @since 0.4.0
   */
  data?: Json | null;
  /**
   * Arrows only: bind the start to an element added in the same batch.
   *
   * @since 0.4.0
   */
  start?: ElementRef;
  /**
   * Arrows only: bind the end to an element added in the same batch.
   *
   * @since 0.4.0
   */
  end?: ElementRef;
}

/**
 * Names an element added in the same batch by its `ref` (its id does not exist
 * yet). A plain string is always a real element id.
 *
 * @since 0.4.0
 */
export interface ElementRef {
  /** @since 0.4.0 */
  ref: string;
}

/**
 * Fonts a text element or label may use (Excalidraw's own names).
 *
 * @since 0.4.0
 */
export type FontFamilyName =
  | "Excalifont"
  | "Nunito"
  | "Lilita One"
  | "Comic Shanns"
  | "Virgil"
  | "Helvetica"
  | "Cascadia"
  | "Liberation Sans";

/**
 * One change to the scene; `scene.batch` applies a list as one undo step.
 *
 * @since 0.1.0
 */
export type SceneOp =
  | {
      op: "add";
      element: NewElement;
      /**
       * A name for the new element within this batch, for `start`, `end` and
       * `group`; the result maps it to the id.
       *
       * @since 0.4.0
       */
      ref?: string;
    }
  | {
      op: "update";
      id: string;
      props: Partial<Omit<NewElement, "type" | "start" | "end">>;
    }
  | { op: "delete"; id: string }
  | {
      /**
       * Groups the listed elements (ids, or `{ ref }` for new ones), as
       * Excalidraw's Group action does. At least two.
       *
       * @since 0.4.0
       */
      op: "group";
      ids: readonly (string | ElementRef)[];
    };

/**
 * What `scene.batch` resolves to.
 *
 * @since 0.4.0
 */
export interface BatchResult {
  /** Ids of the added elements, in op order (labels not included). @since 0.1.0 */
  ids: string[];
  /** Each `ref` of the batch, mapped to the new element's id. @since 0.4.0 */
  refs: Record<string, string>;
}

/**
 * Options of `scene.batch`.
 *
 * @since 0.4.0
 */
export interface BatchOptions {
  /**
   * Apply only if this drawing (vault-relative path, as `scene.path()`) is
   * still the active one; otherwise reject with `code: "DRAWING_CHANGED"`.
   *
   * @since 0.4.0
   */
  path?: string;
}

/**
 * One element with more detail than `elements()` gives, from `scene.get`.
 *
 * @since 0.4.0
 */
export interface SceneElementDetail extends SceneElement {
  /** Innermost group first. @since 0.4.0 */
  readonly groupIds: readonly string[];
  /** @since 0.4.0 */
  readonly frameId: string | null;
  /** The shape a label belongs to. @since 0.4.0 */
  readonly containerId: string | null;
  /** @since 0.4.0 */
  readonly locked: boolean;
  /** @since 0.4.0 */
  readonly link: string | null;
  /** @since 0.4.0 */
  readonly opacity: number;
  /** @since 0.4.0 */
  readonly strokeWidth: number;
  /** @since 0.4.0 */
  readonly strokeStyle: string;
  /** @since 0.4.0 */
  readonly fillStyle: string;
  /** @since 0.4.0 */
  readonly roundness: "sharp" | "round";
  /** Text elements only. @since 0.4.0 */
  readonly fontSize?: number;
  /** Text elements only; the font's name, or its number when it has none. @since 0.4.0 */
  readonly fontFamily?: string;
  /** Images only. @since 0.4.0 */
  readonly fileId?: string | null;
  /** Lines and arrows, when asked with `{ points: true }`. @since 0.4.0 */
  readonly points?: readonly (readonly [number, number])[];
  /** This plugin's data, when asked with `{ data: true }`. @since 0.4.0 */
  readonly data?: Json;
}

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
   * Applies the ops as ONE undo step. Rejects: no drawing (`NOT_FOUND`),
   * read-only (`READ_ONLY`), invalid ops (`INVALID_ARGUMENT`, with `issues`),
   * another drawing active than `options.path` (`DRAWING_CHANGED`).
   *
   * @since 0.1.0
   */
  batch(ops: readonly SceneOp[], options?: BatchOptions): Promise<BatchResult>;
  /**
   * Centre of the visible canvas in scene coordinates.
   *
   * @since 0.1.0
   */
  viewportCenter(): { x: number; y: number };
  /**
   * Copies of the listed elements with more detail (groups, frame, label
   * container, style, link, lock), in the order asked; missing or deleted ids
   * are left out. `points` and `data` cost more and are off by default.
   *
   * @since 0.4.0
   */
  get(
    ids: readonly string[],
    options?: { points?: boolean; data?: boolean },
  ): readonly SceneElementDetail[];
  /**
   * This plugin's data on an element (a copy), undefined when it has none.
   *
   * @since 0.4.0
   */
  dataOf(id: string): Json | undefined;
  /**
   * The active drawing's vault-relative path, null when none is open.
   *
   * @since 0.4.0
   */
  path(): string | null;
}
