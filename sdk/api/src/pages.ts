/**
 * `ctx.pages`: page sizes, a paginator, and (since 0.9.0) page documents:
 * drawings built from laid-out items, streamed into the open editor or
 * written whole.
 */
import type { FontFamilyName } from "./scene";

/**
 * The page sizes the editor offers.
 *
 * @since 0.8.0
 */
export type PageSizeName =
  | "a3"
  | "a4"
  | "a5"
  | "b5"
  | "letter"
  | "legal"
  | "tablet"
  | "tabletLarge"
  | "phone";

/**
 * Which page to describe; missing fields take the editor's defaults
 * (A4, portrait, separate pages).
 *
 * @since 0.8.0
 */
export interface PageRequest {
  /** A named size, or a custom size in scene pixels (each side 100 to 5000). @since 0.8.0 */
  size?: PageSizeName | { width: number; height: number };
  /** Ignored for a custom size. @since 0.8.0 */
  orientation?: "portrait" | "landscape";
  /** Separate pages have a gap between them; a continuous roll has none. @since 0.8.0 */
  layout?: "separate" | "continuous";
}

/**
 * One page's size and where the next page starts, in scene pixels. Page
 * `i` has its top-left corner at `(0, i * pitch)`.
 *
 * @since 0.8.0
 */
export interface PageGeometry {
  /** @since 0.8.0 */
  readonly width: number;
  /** @since 0.8.0 */
  readonly height: number;
  /** Space between pages. @since 0.8.0 */
  readonly gap: number;
  /** `height + gap`. @since 0.8.0 */
  readonly pitch: number;
}

/**
 * One item to place: a line, a block or anything else with a height.
 *
 * @since 0.8.0
 */
export interface FlowItem {
  /** @since 0.8.0 */
  height: number;
  /** Space above the item; dropped at the top of a page. @since 0.8.0 */
  spaceBefore?: number;
  /** Start a new page with this item (unless the page is still empty). @since 0.8.0 */
  breakBefore?: boolean;
  /** Keep on the same page as the next item (a heading and its first line). @since 0.8.0 */
  keepWithNext?: boolean;
}

/**
 * The area items flow into on each page.
 *
 * @since 0.8.0
 */
export interface FlowOptions {
  /** Height available on each page (the page height minus margins). @since 0.8.0 */
  contentHeight: number;
}

/**
 * Where an item landed: the page index and the offset from the top of
 * that page's content area. An item taller than `contentHeight` gets a page
 * of its own and overflows it; split it before flowing.
 *
 * @since 0.8.0
 */
export interface FlowPlacement {
  /** @since 0.8.0 */
  readonly page: number;
  /** @since 0.8.0 */
  readonly y: number;
}

/**
 * Page geometry and pagination.
 *
 * @since 0.8.0
 */
export interface PagesApi {
  /**
   * The size and spacing of a page.
   *
   * @since 0.8.0
   */
  geometry(request?: PageRequest): PageGeometry;
  /**
   * Greedy pagination: each item goes on the current page if it fits, else
   * on the next one; `keepWithNext` chains move together when they fit on
   * one page. Linear time (about 3 ms for 50,000 words of lines). At most
   * 1,000,000 items.
   *
   * @since 0.8.0
   */
  flow(items: readonly FlowItem[], options: FlowOptions): FlowPlacement[];
  /**
   * A new page-mode drawing in the open vault, opened from memory and filled
   * through `append`; saved by the app in the background and once more on
   * `finish()`. Rejects with `NO_VAULT`, `READ_ONLY` or `INVALID_ARGUMENT`.
   *
   * @since 0.9.0
   */
  createDocument(options: CreateDocumentOptions): Promise<PageDocument>;
  /**
   * The whole drawing as `.excalidraw` JSON (elements, `appState.pageSetup`,
   * and a file per picture), for writing elsewhere, such as an import target.
   * Nothing opens. Rejects with `INVALID_ARGUMENT`.
   *
   * @since 0.9.0
   */
  buildScene(
    items: readonly PageItem[],
    options: BuildSceneOptions,
  ): Promise<object>;
}

/**
 * The tones the host paints text in: the drawing follows the theme, no
 * theme colours are stamped in. `link`, `code` and `heading1` to `heading6`
 * (headings since 0.34.0) are drawn in the active theme's Markdown colours
 * (`--vault-md-link`, `--vault-md-code`, `--vault-md-h1` …), as an Obsidian
 * theme sets `--link-color` and `--h1-color`.
 *
 * @since 0.9.0
 */
export type PageTextTone =
  | "normal"
  | "muted"
  | "code"
  | "link"
  | "heading1"
  | "heading2"
  | "heading3"
  | "heading4"
  | "heading5"
  | "heading6";

/**
 * What a box is filled with. `code` is drawn in the theme's
 * `--vault-md-code-bg`; `bar` (since 0.34.0), the bar at the left of a
 * quote, in `--vault-md-quote-bar`.
 *
 * @since 0.9.0
 */
export type PageRectFill =
  | "code"
  | "quote"
  | "callout"
  | "table"
  | "bar"
  | "none";

/**
 * A text already wrapped by the plugin: lines joined by `"\n"`, sized by the
 * plugin's own measuring. The host never measures or re-wraps it.
 *
 * @since 0.9.0
 */
export interface PageTextItem {
  /** @since 0.9.0 */
  type: "text";
  /** Page index, from 0. @since 0.9.0 */
  page: number;
  /** Scene pixels from the page's top-left corner. @since 0.9.0 */
  x: number;
  /** @since 0.9.0 */
  y: number;
  /** @since 0.9.0 */
  width: number;
  /** @since 0.9.0 */
  height: number;
  /** At most 10,000 characters. @since 0.9.0 */
  text: string;
  /** @since 0.9.0 */
  fontSize: number;
  /** @since 0.9.0 */
  fontFamily: FontFamilyName;
  /** The bold variant of the family. Wrap with `ctx.text.measure({ …, bold: true })`. @since 0.36.0 */
  bold?: boolean;
  /** A multiple of the font size, as `ctx.text.lineHeight` gives it. @since 0.9.0 */
  lineHeight: number;
  /** @since 0.9.0 */
  align?: "left" | "center" | "right";
  /** @since 0.9.0 */
  tone?: PageTextTone;
  /** A link opened from the text (`javascript:`, `data:`, `vbscript:` and `file:` are refused). @since 0.9.0 */
  link?: string;
  /** The plugin's own data on the element (at most 4 KiB as JSON), as `NewElement.data`. @since 0.9.0 */
  data?: Record<string, unknown>;
  /** Items with the same name become one group in the editor (they select and move as one; double-click edits a member). 1 to 64 letters, digits, `_`, `-`, `.` or `:`. @since 0.32.0 */
  group?: string;
}

/**
 * A filled box behind text (a code block, a quote, a callout, a table).
 *
 * @since 0.9.0
 */
export interface PageRectItem {
  /** @since 0.9.0 */
  type: "rect";
  /** @since 0.9.0 */
  page: number;
  /** @since 0.9.0 */
  x: number;
  /** @since 0.9.0 */
  y: number;
  /** @since 0.9.0 */
  width: number;
  /** @since 0.9.0 */
  height: number;
  /** @since 0.9.0 */
  fill: PageRectFill;
  /** Default "none". @since 0.9.0 */
  stroke?: "none" | "thin";
  /** Items with the same name become one group in the editor (they select and move as one; double-click edits a member). 1 to 64 letters, digits, `_`, `-`, `.` or `:`. @since 0.32.0 */
  group?: string;
}

/**
 * A straight line from `(x, y)` to `(x + width, y + height)`: a rule, a table grid.
 *
 * @since 0.9.0
 */
export interface PageLineItem {
  /** @since 0.9.0 */
  type: "line";
  /** @since 0.9.0 */
  page: number;
  /** @since 0.9.0 */
  x: number;
  /** @since 0.9.0 */
  y: number;
  /** @since 0.9.0 */
  width: number;
  /** @since 0.9.0 */
  height: number;
  /** A heavier line (twice the width), e.g. the rule under a table's header: Excalidraw text has no bold. @since 0.32.0 */
  strong?: boolean;
  /** Items with the same name become one group in the editor (they select and move as one; double-click edits a member). 1 to 64 letters, digits, `_`, `-`, `.` or `:`. @since 0.32.0 */
  group?: string;
}

/**
 * A picture. With `bytes`, an image element and its file (at most 10 MiB, PNG,
 * JPEG, GIF, WebP or SVG, the bytes must look like `mimeType`). Without, a
 * placeholder box with the `alt` text, linked to `target`.
 *
 * @since 0.9.0
 */
export interface PageImageItem {
  /** @since 0.9.0 */
  type: "image";
  /** @since 0.9.0 */
  page: number;
  /** @since 0.9.0 */
  x: number;
  /** @since 0.9.0 */
  y: number;
  /** @since 0.9.0 */
  width: number;
  /** @since 0.9.0 */
  height: number;
  /** @since 0.9.0 */
  mimeType: string;
  /** @since 0.9.0 */
  bytes?: Uint8Array;
  /** @since 0.9.0 */
  alt?: string;
  /** Where the picture came from (the placeholder's link). @since 0.9.0 */
  target: string;
  /** Items with the same name become one group in the editor (they select and move as one; double-click edits a member). 1 to 64 letters, digits, `_`, `-`, `.` or `:`. @since 0.32.0 */
  group?: string;
}

/**
 * One item of a laid-out page, as the plugin's layout produced it. Coordinates
 * are scene pixels relative to the page's top-left corner.
 *
 * @since 0.9.0
 */
export type PageItem =
  | PageTextItem
  | PageRectItem
  | PageLineItem
  | PageImageItem;

/**
 * Options of `pages.createDocument`.
 *
 * @since 0.9.0
 */
export interface CreateDocumentOptions {
  /**
   * The drawing's name without the extension. A name already taken gets a
   * number: `Note (imported) 2.excalidraw`.
   *
   * @since 0.9.0
   */
  name: string;
  /** Vault folder (`""` is the root). Default: where a new drawing goes. @since 0.9.0 */
  parent?: string;
  /** The page size and layout. Default: A4, portrait, separate pages. @since 0.9.0 */
  setup?: PageRequest;
  /**
   * Open the drawing and stream into it (the default). With `false` the items
   * are collected and written once on `finish()`, and nothing opens.
   *
   * @since 0.9.0
   */
  open?: boolean;
}

/**
 * A page-mode drawing being filled. Items are queued and applied one frame
 * at a time, so the first page shows while the rest is still coming.
 *
 * @since 0.9.0
 */
export interface PageDocument {
  /** The drawing's vault-relative path, name de-duplicated. @since 0.9.0 */
  readonly path: string;
  /**
   * Queues items; `pageCount` is the number of pages they reach (the drawing
   * grows to it, never shrinks). Invalid items are refused with
   * `INVALID_ARGUMENT` and nothing of that call is queued.
   *
   * @since 0.9.0
   */
  append(items: readonly PageItem[], pageCount: number): void;
  /**
   * Applies what is queued, then saves once. Resolves to the path and the
   * saved revision. If the user closed the drawing while items were still
   * coming, what was applied stays saved and the rest is dropped.
   *
   * @since 0.9.0
   */
  finish(): Promise<{ path: string; revision: string }>;
  /** Drops what is still queued, keeps and saves what was applied. @since 0.9.0 */
  abort(): Promise<void>;
}

/**
 * Options of `pages.buildScene`.
 *
 * @since 0.9.0
 */
export interface BuildSceneOptions {
  /** @since 0.9.0 */
  setup?: PageRequest;
  /** Pages in the drawing, 1 or more. @since 0.9.0 */
  pageCount: number;
}
