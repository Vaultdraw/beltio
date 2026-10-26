/**
 * `ctx.pages`: page sizes and a paginator, for plugins that lay content out
 * on the editor's pages (page mode).
 */

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
}
