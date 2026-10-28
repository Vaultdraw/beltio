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
 * | table | a grid: header row shaded, borders, wrapped cells, widths from the content (no cap) |
 * | image / embed | an image box (bytes come later) / a `[[target]]` link line |
 * | math | the LaTeX as code-toned text |
 * | footnotes | `[n]` stays in the text; definitions go at the end of the note |
 * | html | the text, muted |
 */
import { headingRole } from "./fonts";
import { htmlImages, literalImages } from "./literalImages";

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

export interface MappedTable {
  kind: "table";
  header: readonly string[];
  rows: readonly (readonly string[])[];
  align: readonly string[];
  spaceBefore: number;
}

export type Mapped =
  | MappedText
  | MappedTable
  | MappedList
  | MappedImage
  | { kind: "rule"; spaceBefore: number }
  | { kind: "open"; fill: Fill }
  | { kind: "close" };

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

const imageOf = (b: {
  target: string;
  alt?: string;
  width?: number;
  height?: number;
}): MappedImage => ({
  kind: "image",
  target: b.target,
  mimeType: mimeOf(b.target),
  spaceBefore: SPACE.block,
  ...(b.alt ? { alt: b.alt } : {}),
  ...(b.width ? { width: b.width } : {}),
  ...(b.height ? { height: b.height } : {}),
});

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
        const pieces = literalImages(b.text);
        if (pieces) {
          for (const p of pieces) {
            yield p.kind === "text" ? text("body", p.text) : imageOf(p);
          }
          break;
        }
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
        yield* mapBlocks(b.blocks, footnotes);
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
        yield* mapBlocks(b.blocks, footnotes);
        yield { kind: "close" };
        break;
      case "thematicBreak":
        yield { kind: "rule", spaceBefore: SPACE.block };
        break;
      case "table":
        yield {
          kind: "table",
          header: b.header,
          rows: b.rows,
          align: b.align,
          spaceBefore: SPACE.block,
        };
        break;
      case "image":
        yield imageOf(b);
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
      case "html": {
        const imgs = htmlImages(b.text);
        if (imgs) {
          for (const p of imgs) {
            yield imageOf(p);
          }
          break;
        }
        yield text("body", b.text, { tone: "muted" });
        break;
      }
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
export function* mapNote(doc: NoteDoc): Generator<Mapped> {
  const footnotes: Extract<NoteBlock, { kind: "footnoteDef" }>[] = [];
  yield* mapBlocks(doc.blocks, footnotes);
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
    yield* mapBlocks(rest, []);
  }
}
