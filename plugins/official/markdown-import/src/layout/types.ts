/**
 * Types of the layout stage: what the plugin's worker turns a `NoteDoc` into.
 * `PageItem` is the contract with the host (personal/feature/markdown-import/
 * PHASE4-PLAN.md, "Layout output"): coordinates are scene pixels relative to
 * the page's top-left corner, text is already wrapped (lines joined by `\n`).
 */
import type {
  FontFamilyName,
  PageRectFill,
  PageTextTone,
} from "@vaultdraw/api";

export type { FontFamilyName };

export type PageItemText = {
  type: "text";
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  fontSize: number;
  fontFamily: FontFamilyName;
  lineHeight: number;
  align?: "left" | "center" | "right";
  tone?: PageTextTone;
  link?: string;
  /** At most 4 KiB as JSON, e.g. `{ heading: 2 }`. */
  data?: Record<string, unknown>;
  /** Items with the same name are one group in the editor (a table moves as one). */
  group?: string;
};

export type PageItemRect = {
  type: "rect";
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: PageRectFill;
  stroke?: "none" | "thin";
  /** Items with the same name are one group in the editor (a table moves as one). */
  group?: string;
};

export type PageItemLine = {
  type: "line";
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Twice the width: the rule under a table's header. */
  strong?: boolean;
  /** Items with the same name are one group in the editor (a table moves as one). */
  group?: string;
};

export type PageItemImage = {
  type: "image";
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  mimeType: string;
  bytes?: Uint8Array;
  alt?: string;
  /** The image path as written in the note; the caller fills `bytes` if it has them. */
  target: string;
};

export type PageItem =
  | PageItemText
  | PageItemRect
  | PageItemLine
  | PageItemImage;

/** The three font roles a note uses. */
export interface LayoutFonts {
  body: FontFamilyName;
  heading: FontFamilyName;
  code: FontFamilyName;
}

/** Page size and margins in scene pixels. */
export interface LayoutPage {
  width: number;
  height: number;
  margin: number | { top: number; right: number; bottom: number; left: number };
}

/** What `layoutNote` needs besides the note and the width table. */
export interface LayoutOptions {
  fonts: LayoutFonts;
  /** Body size in scene pixels; headings and code scale from it. */
  fontSize: number;
  page: LayoutPage;
  /** Split the result into parts of about this many elements (default 1000). */
  partElements?: number;
  /** Colour each heading level from the theme (`heading_colors`, default on). */
  headingColors?: boolean;
}

/** Counts from a layout. */
export interface LayoutStats {
  words: number;
  blocks: number;
  elements: number;
  pages: number;
  parts: number;
  /** Blocks the slice does not draw (raw HTML is kept as text, so this is 0 today). */
  skipped: number;
}

export interface LayoutPart {
  title: string;
  items: PageItem[];
  pageCount: number;
}

export interface LayoutResult {
  parts: LayoutPart[];
  stats: LayoutStats;
}

/**
 * What the streaming form yields, in order: `part` (a new part starts), then
 * one `page` per completed page of that part, `partEnd`, and `done` last.
 */
export type LayoutEvent =
  | { type: "part"; partIndex: number; title: string }
  | {
      type: "page";
      partIndex: number;
      page: number;
      items: PageItem[];
      /** Pages of this part so far (this one included). */
      pageCount: number;
    }
  | { type: "partEnd"; partIndex: number; pageCount: number; elements: number }
  | { type: "done"; stats: LayoutStats };
