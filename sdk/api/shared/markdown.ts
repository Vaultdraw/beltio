/**
 * `ctx.markdown` rules shared by the app's host and the mock: the argument
 * checks of the Rust gateway row `markdown.parse`, and a small fake parser
 * for tests without the app. The fake knows headings, paragraphs, `#tags`
 * and `[[wikilinks]]` only; the real parser is the Rust one
 * (vaultdraw_core::markdown).
 */
import { PluginApiError, utf8Length } from "./rules";

import type {
  MarkdownParseOptions,
  NoteBlock,
  NoteDoc,
  NoteInline,
} from "@vaultdraw/api";

/** The largest text the parser takes, in UTF-8 bytes (the Rust limit). */
export const MAX_MARKDOWN_BYTES = 16 * 1024 * 1024;

/** The gateway params for `markdown.parse`, checked as Rust checks them. */
export const markdownParams = (
  text: unknown,
  options?: MarkdownParseOptions,
): { text: string; softBreakNewline?: boolean } => {
  if (typeof text !== "string") {
    throw new PluginApiError("INVALID_ARGUMENT", "text must be a string");
  }
  // Cheap bound first: a UTF-16 unit is at most 3 UTF-8 bytes.
  if (
    text.length * 3 > MAX_MARKDOWN_BYTES &&
    utf8Length(text) > MAX_MARKDOWN_BYTES
  ) {
    throw new PluginApiError(
      "INVALID_ARGUMENT",
      "Markdown text exceeds the 16 MiB limit",
    );
  }
  if (
    options !== undefined &&
    (options === null || typeof options !== "object")
  ) {
    throw new PluginApiError("INVALID_ARGUMENT", "options must be an object");
  }
  const soft = options?.softBreakNewline;
  if (soft !== undefined && typeof soft !== "boolean") {
    throw new PluginApiError(
      "INVALID_ARGUMENT",
      "softBreakNewline must be a boolean",
    );
  }
  return soft === undefined ? { text } : { text, softBreakNewline: soft };
};

const TAG = /(^|\s)#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu;
const WIKILINK = /\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g;

/** Wikilink spans over the literal text, as the Rust parser reports them. */
const wikilinkSpans = (text: string): NoteInline[] =>
  [...text.matchAll(WIKILINK)].map((m) => ({
    kind: "wikilink" as const,
    start: m.index!,
    end: m.index! + m[0].length,
    target: m[1].trim(),
    ...(m[2] ? { heading: m[2] } : {}),
    ...(m[3] ? { alias: m[3] } : {}),
  }));

const withSpans = <T extends { text: string }>(
  block: T,
): T & { inline?: NoteInline[] } => {
  const inline = block.text.startsWith("![[") ? [] : wikilinkSpans(block.text);
  return inline.length ? { ...block, inline } : block;
};

const IMAGE_NAME = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i;

const cells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.replace(/\\\|/g, "|").trim());

/** A pipe table or a whole-paragraph image (`![[a.png|300]]`, `![alt](a b.png)`), as the real parser reports them. */
const tableOrImage = (
  body: string,
  range: readonly [number, number],
): NoteBlock | null => {
  const lines = body.split("\n");
  if (
    lines.length >= 2 &&
    lines.every((l) => l.trim().startsWith("|")) &&
    /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/.test(lines[1].trim())
  ) {
    const header = cells(lines[0]);
    const align = cells(lines[1]).map((c) =>
      c.startsWith(":") && c.endsWith(":")
        ? ("center" as const)
        : c.endsWith(":")
        ? ("right" as const)
        : c.startsWith(":")
        ? ("left" as const)
        : ("none" as const),
    );
    const rows = lines.slice(2).map(cells);
    return {
      kind: "table",
      align,
      header,
      rows,
      cols: header.length,
      cellCount: (rows.length + 1) * header.length,
      range,
    } as NoteBlock;
  }
  const wiki = /^!\[\[([^\]|#]+)(?:\|([^\]]*))?\]\]$/.exec(body);
  if (wiki && IMAGE_NAME.test(wiki[1].trim())) {
    const size = /^(\d+)(?:x(\d+))?$/.exec(
      (wiki[2] ?? "").split("|").pop() ?? "",
    );
    return {
      kind: "image",
      target: wiki[1].trim(),
      remote: false,
      ...(size ? { width: Number(size[1]) } : {}),
      range,
    } as NoteBlock;
  }
  const md = /^!\[([^\]]*)\]\(<?([^)>]+?)>?\)$/.exec(body);
  if (md) {
    let target = md[2].trim();
    try {
      target = decodeURIComponent(target);
    } catch {
      // keep as written
    }
    const remote = /^(https?|data):/i.test(target);
    if (remote || IMAGE_NAME.test(target)) {
      return {
        kind: "image",
        target,
        remote,
        ...(md[1] ? { alt: md[1] } : {}),
        range,
      } as NoteBlock;
    }
  }
  return null;
};

/** A small stand-in for the Rust parser (see the file comment). */
export const fakeParseMarkdown = (
  text: string,
  options?: MarkdownParseOptions,
): NoteDoc => {
  const enc = new TextEncoder();
  const blocks: NoteBlock[] = [];
  const links: NoteDoc["links"][number][] = [];
  const tags: string[] = [];
  const seen = new Set<string>();
  let words = 0;
  let offset = 0;
  for (const chunk of text.split(/(\n\s*\n)/)) {
    const start = offset;
    offset += enc.encode(chunk).length;
    if (!chunk.trim() || /^\n\s*\n$/.test(chunk)) {
      continue;
    }
    const range = [start, offset] as const;
    const body = chunk.trim();
    words += body.split(/\s+/).filter(Boolean).length;
    for (const m of body.matchAll(TAG)) {
      const key = m[2].toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        tags.push(m[2]);
      }
    }
    for (const m of body.matchAll(WIKILINK)) {
      links.push({
        kind: "wikilink",
        target: m[1].trim(),
        ...(m[2] ? { heading: m[2] } : {}),
        ...(m[3] ? { alias: m[3] } : {}),
        range,
      });
    }
    const special = tableOrImage(body, range);
    if (special) {
      blocks.push(special);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/s.exec(body);
    const flat = options?.softBreakNewline ? body : body.replace(/\n/g, " ");
    blocks.push(
      withSpans(
        heading
          ? {
              kind: "heading" as const,
              level: heading[1].length,
              text: heading[2].trim(),
              range,
            }
          : { kind: "paragraph" as const, text: flat, range },
      ),
    );
  }
  return {
    schemaVersion: 1,
    blocks,
    links,
    tags,
    stats: {
      words,
      blocks: blocks.length,
      droppedEmphasis: 0,
      droppedHtml: 0,
    },
  };
};
