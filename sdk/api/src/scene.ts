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
  type:
    | "rectangle"
    | "ellipse"
    | "diamond"
    | "text"
    | "arrow"
    | "line"
    /** Needs `image`, `width` and `height`. @since 0.7.0 */
    | "image";
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
   * The picture of an `image` element (and only of that). `width` and `height`
   * are the size it is shown at. The bytes are hashed (SHA-1, as the editor
   * does), so adding the same picture twice stores it once. A batch is
   * refused with `TOO_LARGE` when the drawing would pass 90% of its 32 MiB
   * size cap. Arrows cannot bind to images. In an `update` (since 0.25.0) it
   * swaps the picture of an existing image in place: the id, z-order, groups,
   * bound arrows, frame, angle and lock stay, and it is one undo step.
   * Combine it with `width` and `height` to change the size.
   *
   * @since 0.7.0
   */
  image?: ImageSource;
  /**
   * Arrows only: bind the start to an element added in the same batch
   * (`{ ref }`) or, since 0.9.0, to one already on the canvas (`{ id }`).
   *
   * @since 0.4.0
   */
  start?: ElementRef | ElementId;
  /**
   * Arrows only: bind the end to an element added in the same batch
   * (`{ ref }`) or, since 0.9.0, to one already on the canvas (`{ id }`).
   *
   * @since 0.4.0
   */
  end?: ElementRef | ElementId;
}

/**
 * The picture of an added image: at most 10 MiB, PNG, JPEG, GIF, WebP or SVG;
 * the bytes must look like the declared type.
 *
 * @since 0.7.0
 */
export interface ImageSource {
  /** @since 0.7.0 */
  mime:
    | "image/png"
    | "image/jpeg"
    | "image/gif"
    | "image/webp"
    | "image/svg+xml";
  /** @since 0.7.0 */
  bytes: Uint8Array;
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
 * Names an element already on the canvas as an arrow's `start` or `end`. It
 * must exist, not be deleted (also not later in the same batch), and be a
 * rectangle, ellipse, diamond, image or text that is not a shape's label. The
 * arrow is drawn between the two outlines and bound as if the user had drawn
 * it: the element lists the arrow in its bound elements and moving it moves
 * the arrow. One undo step removes the arrow and the binding.
 *
 * @since 0.9.0
 */
export interface ElementId {
  /** @since 0.9.0 */
  id: string;
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
  /**
   * Page mode only: sets the drawing's page count to this (1 to 500) in the same undo step, so
   * pages added by the batch exist. Ignored when the drawing is not in page mode. Use with the
   * `pageCount` of `scene.placePages`.
   *
   * @since 0.26.0
   */
  pageCount?: number;
  /**
   * Scrolls the view in the same update (no zoom change, nothing selected) so the first added
   * element is centred across and its top edge sits near the top of the view. Ignored in page
   * mode and when the batch adds nothing.
   *
   * @since 0.26.0
   */
  reveal?: boolean;
}

/**
 * A page-sized box in scene coordinates.
 *
 * @since 0.26.0
 */
export interface PageRect {
  /** @since 0.26.0 */
  x: number;
  /** @since 0.26.0 */
  y: number;
  /** @since 0.26.0 */
  width: number;
  /** @since 0.26.0 */
  height: number;
}

/**
 * Where `scene.placePages` puts a run of page pictures in the active drawing.
 *
 * @since 0.26.0
 */
export interface PagePlacement {
  /**
   * One box per requested page, in order. In page mode each box is the picture scaled to fit and
   * centred on its page, starting on the first page after the content. Otherwise the boxes stack
   * downward below the content with a gap. Boxes past `maxPages` still have a position, but the
   * drawing cannot hold those pages.
   *
   * @since 0.26.0
   */
  rects: PageRect[];
  /** Page mode: the page count after the import (pass it as `batch({ pageCount })`). null otherwise. @since 0.26.0 */
  pageCount: number | null;
  /** Page mode: the 0-based page the first picture lands on (the page after the content). null otherwise. @since 0.26.0 */
  firstPage: number | null;
  /** Page mode: how many pages still fit in the drawing's page limit. null when there is no limit. @since 0.26.0 */
  maxPages: number | null;
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
   * another drawing active than `options.path` (`DRAWING_CHANGED`), images that
   * would push the drawing past its size cap (`TOO_LARGE`, since 0.7.0).
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
  /**
   * Selects an element of the active drawing and brings it into view (a bound
   * label focuses its container). Nothing happens for an unknown id or when
   * no drawing is open.
   *
   * @since 0.9.0
   */
  scrollTo(id: string): void;
  /**
   * Ids of the selected elements of the active drawing, [] when none or no drawing is open.
   *
   * @since 0.24.0
   */
  selection(): readonly string[];
  /**
   * The stroke colour the editor gives a new element (what the user last picked).
   *
   * @since 0.24.0
   */
  currentStrokeColor(): string;
  /**
   * Where to put `sizes.length` page pictures (a size is in scene pixels) in the active drawing,
   * following its page mode. Pure: nothing changes until you `batch` the images at the returned
   * boxes. With no drawing open the boxes start at the origin.
   *
   * @since 0.26.0
   */
  placePages(
    sizes: readonly { width: number; height: number }[],
  ): PagePlacement;
  /**
   * The size of the active drawing as it would be saved (elements plus pictures), in bytes. A
   * drawing is capped at 32 MiB, and a batch of pictures is refused above 90% of it. 0 with no
   * drawing open.
   *
   * @since 0.26.0
   */
  sizeBytes(): number;
}
