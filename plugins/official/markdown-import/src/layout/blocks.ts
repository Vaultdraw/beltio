/**
 * Block mappers (slice 1): `NoteDoc` blocks → a flat stream of layout items,
 * still unwrapped (no widths needed here, so this stays pure and fast).
 *
 * | Block | Becomes |
 * | --- | --- |
 * | heading | one text in the heading role, `data: { heading: level }`, kept with the next block |
 * | paragraph | one text; `link` set only when the whole paragraph is one link |
 * | list items | one text per run of items at the same depth, markers inline (•, 1., ☐, ☑) |
 * | code | a "code" box with the code in the monospace role, tabs as 4 spaces |
 * | blockquote / callout | a "quote" / "callout" box; the callout title first |
 * | thematic break | a rule |
 * | table | a "table" box with a monospace grid, capped (8 columns × 200 rows) |
 * | image / embed | an image box (bytes come later) / a `[[target]]` link line |
 * | math | the LaTeX as code-toned text |
 * | footnotes | `[n]` stays in the text; definitions go at the end of the note |
 * | html | the text, muted |
 */
import { headingRole } from "./fonts";

import type { NoteBlock, NoteDoc, NoteInline } from "@vaultdraw/api";
import type { RoleName } from "./fonts";
import type { PageItemRect, PageItemText } from "./types";

export type Fill = PageItemRect["fill"];

export interface MappedText {
  kind: "text";
  role: RoleName;
  text: string;
  /** Space above, in body lines. */
  spaceBefore: number;
  keepWithNext: boolean;
  /** May break across pages between lines. */
  splittable: boolean;
  tone?: PageItemText["tone"];
  link?: string;
  data?: Record<string, unknown>;
  /** A part may start here (headings of level 1 and 2). */
  cut?: 1 | 2;
}

export interface MappedListItem {
  /** The marker as drawn, with its trailing space: "• ", "1. ", "☐ ". */
  prefix: string;
  text: string;
}

export interface MappedList {
  kind: "list";
  /** 0 for the outermost list; the layout indents by depth. */
  depth: number;
  items: MappedListItem[];
  spaceBefore: number;
}

export interface MappedImage {
  kind: "image";
  target: string;
  mimeType: string;
  alt?: string;
  width?: number;
  height?: number;
  spaceBefore: number;
}

export type Mapped =
  | MappedText
  | MappedList
  | MappedImage
  | { kind: "rule"; spaceBefore: number }
  | { kind: "open"; fill: Fill }
  | { kind: "close" };

export interface MapOptions {
  /** Characters that fit on one monospace line (tables are shaped to it). */
  tableChars: number;
  tableCap: { cols: number; rows: number };
}

const SPACE = { paragraph: 0.5, heading: 1, list: 0.5, block: 0.5 };
const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  bmp: "image/bmp",
};

export const mimeOf = (target: string): string => {
  const clean = target.split(/[?#]/)[0];
  const dot = clean.lastIndexOf(".");
  const ext = dot >= 0 ? clean.slice(dot + 1).toLowerCase() : "";
  return MIME[ext] ?? "application/octet-stream";
};

/** `target` when the paragraph's text is exactly one external link. */
const wholeLink = (
  text: string,
  inline?: readonly NoteInline[],
): string | undefined => {
  if (!inline || inline.length !== 1 || inline[0].kind !== "link") {
    return undefined;
  }
  const span = inline[0];
  const trimmed = text.trim();
  const start = text.indexOf(trimmed);
  return span.start <= start && span.end >= start + trimmed.length
    ? span.target
    : undefined;
};

const marker = (b: Extract<NoteBlock, { kind: "listItem" }>): string => {
  if (b.task === "open") {
    return "☐ ";
  }
  if (b.task === "done") {
    return "☑ ";
  }
  return b.ordered ? `${b.marker} ` : "• ";
};

const ELLIPSIS = "…";

const clip = (s: string, width: number): string =>
  s.length <= width ? s : s.slice(0, Math.max(0, width - 1)) + ELLIPSIS;

const pad = (
  s: string,
  width: number,
  align: "none" | "left" | "center" | "right",
): string => {
  const gap = width - s.length;
  if (gap <= 0) {
    return s;
  }
  if (align === "right") {
    return " ".repeat(gap) + s;
  }
  if (align === "center") {
    const left = Math.floor(gap / 2);
    return " ".repeat(left) + s + " ".repeat(gap - left);
  }
  return s + " ".repeat(gap);
};

/** A table as monospace lines, shaped to `maxChars` columns. */
export const tableLines = (
  b: Extract<NoteBlock, { kind: "table" }>,
  opts: MapOptions,
): string[] => {
  const cols = Math.min(b.cols, opts.tableCap.cols, b.header.length || b.cols);
  const rows = b.rows.slice(0, opts.tableCap.rows);
  const cell = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
  const header = Array.from({ length: cols }, (_, i) => cell(b.header[i]));
  const body = rows.map((r) =>
    Array.from({ length: cols }, (_, i) => cell(r[i])),
  );
  const widths = header.map((h, i) =>
    Math.max(1, h.length, ...body.map((r) => r[i].length)),
  );
  const sep = " │ ";
  const MIN = 4;
  const total = () =>
    widths.reduce((a, w) => a + w, 0) + sep.length * (cols - 1);
  // Shrink the widest column until the table fits, never below MIN chars.
  while (total() > opts.tableChars) {
    let widest = 0;
    for (let i = 1; i < cols; i++) {
      if (widths[i] > widths[widest]) {
        widest = i;
      }
    }
    if (widths[widest] <= MIN) {
      break;
    }
    widths[widest]--;
  }
  const align = (i: number) => b.align[i] ?? "none";
  const line = (r: string[]) =>
    r.map((c, i) => pad(clip(c, widths[i]), widths[i], align(i))).join(sep);
  const out = [line(header), widths.map((w) => "─".repeat(w)).join("─┼─")];
  for (const r of body) {
    out.push(line(r));
  }
  const more = b.rows.length - rows.length;
  if (more > 0) {
    out.push(`… ${more} more rows`);
  }
  if (b.cols > cols) {
    out.push(`… ${b.cols - cols} more columns`);
  }
  return out;
};

const text = (
  role: RoleName,
  t: string,
  extra: Partial<MappedText> = {},
): MappedText => ({
  kind: "text",
  role,
  text: t,
  spaceBefore: SPACE.paragraph,
  keepWithNext: false,
  splittable: true,
  ...extra,
});

function* mapList(
  blocks: readonly NoteBlock[],
  from: number,
): Generator<MappedList, number> {
  let i = from;
  let first = true;
  while (i < blocks.length && blocks[i].kind === "listItem") {
    const depth = (blocks[i] as Extract<NoteBlock, { kind: "listItem" }>).depth;
    const items: MappedListItem[] = [];
    while (i < blocks.length) {
      const b = blocks[i];
      if (b.kind !== "listItem" || b.depth !== depth) {
        break;
      }
      items.push({ prefix: marker(b), text: b.text });
      i++;
    }
    yield { kind: "list", depth, items, spaceBefore: first ? SPACE.list : 0 };
    first = false;
  }
  return i;
}

function* mapBlocks(
  blocks: readonly NoteBlock[],
  opts: MapOptions,
  footnotes: Extract<NoteBlock, { kind: "footnoteDef" }>[],
): Generator<Mapped> {
  for (let i = 0; i < blocks.length; ) {
    const b = blocks[i];
    switch (b.kind) {
      case "heading": {
        const level = Math.min(6, Math.max(1, b.level));
        yield text(headingRole(level), b.text, {
          spaceBefore: SPACE.heading,
          keepWithNext: true,
          splittable: false,
          data: { heading: level },
          ...(level <= 2 ? { cut: level as 1 | 2 } : {}),
        });
        break;
      }
      case "paragraph": {
        const link = wholeLink(b.text, b.inline);
        yield text("body", b.text, link ? { link, tone: "link" } : {});
        break;
      }
      case "listItem":
        i = yield* mapList(blocks, i);
        continue;
      case "code":
        yield { kind: "open", fill: "code" };
        yield text("code", b.text.replace(/\t/g, "    "), {
          tone: "code",
          spaceBefore: 0,
        });
        yield { kind: "close" };
        break;
      case "blockquote":
        yield { kind: "open", fill: "quote" };
        yield* mapBlocks(b.blocks, opts, footnotes);
        yield { kind: "close" };
        break;
      case "callout":
        yield { kind: "open", fill: "callout" };
        yield text("title", b.title || b.calloutType, {
          spaceBefore: 0,
          keepWithNext: true,
          splittable: false,
          data: { callout: b.calloutType },
        });
        yield* mapBlocks(b.blocks, opts, footnotes);
        yield { kind: "close" };
        break;
      case "thematicBreak":
        yield { kind: "rule", spaceBefore: SPACE.block };
        break;
      case "table":
        yield { kind: "open", fill: "table" };
        yield text("code", tableLines(b, opts).join("\n"), { spaceBefore: 0 });
        yield { kind: "close" };
        break;
      case "image":
        yield {
          kind: "image",
          target: b.target,
          mimeType: mimeOf(b.target),
          spaceBefore: SPACE.block,
          ...(b.alt ? { alt: b.alt } : {}),
          ...(b.width ? { width: b.width } : {}),
          ...(b.height ? { height: b.height } : {}),
        };
        break;
      case "embed": {
        const ref =
          b.target +
          (b.heading ? `#${b.heading}` : "") +
          (b.blockRef ? `#^${b.blockRef}` : "");
        yield text("body", `[[${ref}]]`, { tone: "link", splittable: false });
        break;
      }
      case "math":
        yield text("code", b.latex, { tone: "code" });
        break;
      case "footnoteDef":
        footnotes.push(b);
        break;
      case "html":
        yield text("body", b.text, { tone: "muted" });
        break;
      default:
        break;
    }
    i++;
  }
}

/**
 * Maps a whole note: its blocks in order, then the footnote definitions
 * after a rule, each as `[label] text`.
 */
export function* mapNote(doc: NoteDoc, opts: MapOptions): Generator<Mapped> {
  const footnotes: Extract<NoteBlock, { kind: "footnoteDef" }>[] = [];
  yield* mapBlocks(doc.blocks, opts, footnotes);
  if (footnotes.length === 0) {
    return;
  }
  yield { kind: "rule", spaceBefore: SPACE.heading };
  for (const f of footnotes) {
    const [first, ...rest] = f.blocks;
    const lead = `[${f.label}] `;
    if (first && first.kind === "paragraph") {
      yield text("body", lead + first.text, { tone: "muted" });
    } else {
      yield text("body", lead.trimEnd(), { tone: "muted", keepWithNext: true });
      if (first) {
        rest.unshift(first);
      }
    }
    yield* mapBlocks(rest, opts, []);
  }
}
