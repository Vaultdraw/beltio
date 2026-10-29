/**
 * `ctx.markdown`: the app's Markdown parser (Rust, CommonMark + GFM + the
 * Obsidian dialect) and the `NoteDoc` it returns. The Rust model is
 * `vaultdraw_core::markdown::model`; both sides must change together.
 */

/**
 * A byte range `[start, end]` in the text that was parsed (UTF-8 bytes,
 * not string indexes). A leading byte order mark is skipped but counted.
 *
 * @since 0.8.0
 */
export type ByteRange = readonly [number, number];

/**
 * The YAML block between `---` fences at the top of a note.
 *
 * @since 0.8.0
 */
export interface NoteFrontmatter {
  /** Byte range of the whole block, fences included. @since 0.8.0 */
  readonly range: ByteRange;
  /** The YAML between the fences, `\r` removed. @since 0.8.0 */
  readonly raw: string;
  /** `tags:` without `#`. @since 0.8.0 */
  readonly tags: readonly string[];
  /** `aliases:`. @since 0.8.0 */
  readonly aliases: readonly string[];
  /** Every top-level key as a string (lists joined with ", "). @since 0.8.0 */
  readonly properties: Readonly<Record<string, string>>;
}

/**
 * Counts from the parse.
 *
 * @since 0.8.0
 */
export interface NoteStats {
  /** @since 0.8.0 */
  readonly words: number;
  /** Blocks, nested ones included. @since 0.8.0 */
  readonly blocks: number;
  /** Bold, italic, strikethrough and highlight spans whose markers were removed. @since 0.8.0 */
  readonly droppedEmphasis: number;
  /** HTML comments removed. @since 0.8.0 */
  readonly droppedHtml: number;
}

/**
 * A marked span inside a block's `text`. `start` and `end` are string
 * indexes (UTF-16 code units) into that `text`.
 *
 * @since 0.8.0
 */
export interface NoteInline {
  /** @since 0.8.0 */
  readonly kind: "wikilink" | "link" | "tag" | "math" | "footnoteRef";
  /** @since 0.8.0 */
  readonly start: number;
  /** @since 0.8.0 */
  readonly end: number;
  /** The wikilink's note, the link URL, the tag name, the LaTeX or the footnote label. @since 0.8.0 */
  readonly target: string;
  /** @since 0.8.0 */
  readonly alias?: string;
  /** @since 0.8.0 */
  readonly heading?: string;
  /** @since 0.8.0 */
  readonly blockRef?: string;
}

/**
 * A bold, italic or code span inside a block's `text` (or a table cell's).
 * `start` and `end` are string indexes (UTF-16 code units). Spans may nest:
 * `***both***` is a bold and an italic span over the same range. Strikethrough
 * is dropped, not marked.
 *
 * @since 0.37.0
 */
export interface NoteMark {
  /** @since 0.37.0 */
  readonly kind: "bold" | "italic" | "code";
  /** @since 0.37.0 */
  readonly start: number;
  /** @since 0.37.0 */
  readonly end: number;
}

/**
 * Fields every block has.
 *
 * @since 0.8.0
 */
export interface NoteBlockBase {
  /** Byte range of the block in the source. @since 0.8.0 */
  readonly range: ByteRange;
  /** The `^block-id` that ended the block. @since 0.8.0 */
  readonly blockId?: string;
}

/**
 * One block of a note. Text is plain: emphasis markers are removed, links
 * and tags are marked in `inline`, bold, italic and code in `marks` (since
 * 0.37.0; absent when there are none).
 *
 * @since 0.8.0
 */
export type NoteBlock = NoteBlockBase &
  (
    | {
        kind: "heading";
        level: number;
        text: string;
        inline?: readonly NoteInline[];
        marks?: readonly NoteMark[];
      }
    | {
        kind: "paragraph";
        text: string;
        inline?: readonly NoteInline[];
        marks?: readonly NoteMark[];
      }
    | {
        kind: "listItem";
        ordered: boolean;
        /** The marker as written: `-`, `*`, `+`, `1.`, `2)`. */
        marker: string;
        /** 0 for the outermost list. */
        depth: number;
        task: "none" | "open" | "done";
        text: string;
        inline?: readonly NoteInline[];
        marks?: readonly NoteMark[];
      }
    | { kind: "code"; code: true; lang?: string; text: string }
    | { kind: "blockquote"; blocks: readonly NoteBlock[] }
    | {
        kind: "callout";
        calloutType: string;
        title: string;
        foldState: "none" | "open" | "closed";
        blocks: readonly NoteBlock[];
      }
    | { kind: "thematicBreak" }
    | {
        kind: "table";
        align: readonly ("none" | "left" | "center" | "right")[];
        header: readonly string[];
        rows: readonly (readonly string[])[];
        cols: number;
        cellCount: number;
        /** Bold, italic and code spans of each header cell (offsets into that cell's text). Absent when there are none. @since 0.37.0 */
        headerMarks?: readonly (readonly NoteMark[])[];
        /** The same for the body cells, row by row. Absent when there are none. @since 0.37.0 */
        rowMarks?: readonly (readonly (readonly NoteMark[])[])[];
      }
    | {
        kind: "image";
        target: string;
        /** True for `http(s):` and `data:` targets, which are never fetched. */
        remote: boolean;
        alt?: string;
        width?: number;
        height?: number;
      }
    | {
        /** `![[Note]]`, `![[Note#Heading]]`, `![[doc.pdf#page=3]]`: an embed that is not an image. */
        kind: "embed";
        target: string;
        heading?: string;
        blockRef?: string;
        alt?: string;
        width?: number;
        height?: number;
      }
    | { kind: "math"; latex: string }
    | { kind: "footnoteDef"; label: string; blocks: readonly NoteBlock[] }
    | { kind: "html"; text: string }
  );

/**
 * A wikilink, embed or Markdown link anywhere in the note.
 *
 * @since 0.8.0
 */
export interface NoteLink {
  /** @since 0.8.0 */
  readonly kind: "wikilink" | "embed" | "link";
  /** @since 0.8.0 */
  readonly target: string;
  /** @since 0.8.0 */
  readonly alias?: string;
  /** @since 0.8.0 */
  readonly heading?: string;
  /** @since 0.8.0 */
  readonly blockRef?: string;
  /** @since 0.8.0 */
  readonly range: ByteRange;
}

/**
 * A parsed note.
 *
 * @since 0.8.0
 */
export interface NoteDoc {
  /** 1 today; rises when a field changes meaning. @since 0.8.0 */
  readonly schemaVersion: number;
  /** @since 0.8.0 */
  readonly frontmatter?: NoteFrontmatter;
  /** Top-level blocks in order; containers hold their children. @since 0.8.0 */
  readonly blocks: readonly NoteBlock[];
  /** @since 0.8.0 */
  readonly links: readonly NoteLink[];
  /** Frontmatter tags, then inline `#tags`, without `#`, never from code. @since 0.8.0 */
  readonly tags: readonly string[];
  /** @since 0.8.0 */
  readonly stats: NoteStats;
}

/**
 * How to parse.
 *
 * @since 0.8.0
 */
export interface MarkdownParseOptions {
  /** A soft line break inside a paragraph becomes `\n` instead of a space. @since 0.8.0 */
  softBreakNewline?: boolean;
}

/**
 * The Markdown parser. Free: no permission needed.
 *
 * @since 0.8.0
 */
export interface MarkdownApi {
  /**
   * Parses Markdown text (at most 16 MiB of UTF-8) into a `NoteDoc`. One
   * native call; about 1 ms for 50,000 words.
   *
   * @since 0.8.0
   */
  parse(text: string, options?: MarkdownParseOptions): Promise<NoteDoc>;
}
