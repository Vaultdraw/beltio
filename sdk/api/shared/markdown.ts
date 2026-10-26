/**
 * `ctx.markdown` rules shared by the app's host and the mock: the argument
 * checks of the Rust gateway row `markdown.parse`, and a small fake parser
 * for tests without the app. The fake knows headings, paragraphs, `#tags`
 * and `[[wikilinks]]` only; the real parser is the Rust one
 * (vaultdraw_core::markdown).
 */
import { PluginApiError, utf8Length } from "./rules";

import type { MarkdownParseOptions, NoteBlock, NoteDoc } from "@vaultdraw/api";

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
    const heading = /^(#{1,6})\s+(.*)$/s.exec(body);
    const flat = options?.softBreakNewline ? body : body.replace(/\n/g, " ");
    blocks.push(
      heading
        ? {
            kind: "heading",
            level: heading[1].length,
            text: heading[2].trim(),
            range,
          }
        : { kind: "paragraph", text: flat, range },
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
