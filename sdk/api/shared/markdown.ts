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
  NoteMark,
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
): T & { inline?: NoteInline[]; marks?: NoteMark[] } => {
  const { text, marks } = styledText(block.text);
  const inline = text.startsWith("![[") ? [] : wikilinkSpans(text);
  return {
    ...block,
    text,
    ...(inline.length ? { inline } : {}),
    ...(marks.length ? { marks } : {}),
  };
};

const MARK_RANK: Record<NoteMark["kind"], number> = {
  bold: 0,
  italic: 1,
  code: 2,
};
const isWord = (c: string | undefined) => !!c && /[\p{L}\p{N}_]/u.test(c);

/**
 * A text's plain form and its bold, italic and code spans, as the Rust parser reports them
 * (pinned by `vaultdraw-core/src/markdown/inline_mark_cases.json`): `**` and `__` are bold, `*`
 * and `_` italic (not inside a word), `***x***` both, backticks code (their text is kept as
 * written), `~~` is dropped, a link keeps its label, wikilinks stay literal. Offsets are UTF-16.
 */
export const styledText = (
  src: string,
): { text: string; marks: NoteMark[] } => {
  const marks: NoteMark[] = [];
  const run = (s: string, at: number): string => {
    let out = "";
    let i = 0;
    const rest = () => s.slice(i);
    const wrap = (
      open: number,
      content: string,
      kinds: readonly NoteMark["kind"][],
      end: number,
    ) => {
      const start = at + out.length;
      out += run(content, start);
      for (const kind of kinds) {
        if (at + out.length > start) {
          marks.push({ kind, start, end: at + out.length });
        }
      }
      i = end;
      return open;
    };
    while (i < s.length) {
      const c = s[i];
      const prev = s[i - 1];
      let m: RegExpExecArray | null;
      if (c === "\\" && /[*_`~\\[\]|]/.test(s[i + 1] ?? "")) {
        out += s[i + 1];
        i += 2;
      } else if (c === "`") {
        const ticks = /^`+/.exec(rest())![0];
        const close = s.indexOf(ticks, i + ticks.length);
        if (close < 0) {
          out += ticks;
          i += ticks.length;
          continue;
        }
        let code = s.slice(i + ticks.length, close);
        if (/^ .* $/s.test(code) && code.trim()) {
          code = code.slice(1, -1);
        }
        const start = at + out.length;
        out += code;
        if (code) {
          marks.push({ kind: "code", start, end: at + out.length });
        }
        i = close + ticks.length;
      } else if ((m = /^\[\[[^\]]*\]\]/.exec(rest()))) {
        out += m[0];
        i += m[0].length;
      } else if ((m = /^!?\[([^\]]*)\]\(([^)]*)\)/.exec(rest()))) {
        out += run(m[1], at + out.length);
        i += m[0].length;
      } else if (
        (c === "*" || (c === "_" && !isWord(prev))) &&
        (m = new RegExp(
          `^(\\${c}{3})(?=\\S)([\\s\\S]*?\\S)\\1${c === "_" ? "(?!\\w)" : ""}`,
        ).exec(rest()))
      ) {
        wrap(0, m[2], ["bold", "italic"], i + m[0].length);
      } else if (
        (c === "*" || (c === "_" && !isWord(prev))) &&
        (m = new RegExp(
          `^(\\${c}{2})(?=\\S)([\\s\\S]*?\\S)\\1${c === "_" ? "(?!\\w)" : ""}`,
        ).exec(rest()))
      ) {
        wrap(0, m[2], ["bold"], i + m[0].length);
      } else if (c === "~" && (m = /^~~(?=\S)([\s\S]*?\S)~~/.exec(rest()))) {
        wrap(0, m[1], [], i + m[0].length);
      } else if (
        (c === "*" || (c === "_" && !isWord(prev))) &&
        (m = new RegExp(
          `^\\${c}(?=\\S)([\\s\\S]*?\\S)\\${c}${
            c === "_" ? "(?!\\w)" : "(?!\\*)"
          }`,
        ).exec(rest()))
      ) {
        wrap(0, m[1], ["italic"], i + m[0].length);
      } else {
        out += c;
        i += 1;
      }
    }
    return out;
  };
  const text = run(src, 0);
  const lead = text.length - text.trimStart().length;
  const trimmed = text.trim();
  const out = marks
    .map((k) => ({
      ...k,
      start: Math.max(0, k.start - lead),
      end: Math.min(trimmed.length, k.end - lead),
    }))
    .filter((k) => k.start < k.end)
    .sort(
      (a, b) =>
        a.start - b.start ||
        a.end - b.end ||
        MARK_RANK[a.kind] - MARK_RANK[b.kind],
    );
  return { text: trimmed, marks: out };
};

const IMAGE_NAME = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i;

/**
 * A cell's plain text, as the Rust parser gives it: code spans keep their text, links their
 * label, and bold, italic and strikethrough marks are dropped (`_` inside a word stays).
 * Pinned with the Rust parser by `vaultdraw-core/src/markdown/table_cell_cases.json`.
 */
export const plainCell = (cell: string): string => {
  const code: string[] = [];
  return (
    cell
      .replace(/\\\|/g, "|")
      .replace(
        /`([^`]*)`/g,
        (_, c: string) => `\u0000${code.push(c) - 1}\u0000`,
      )
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/(\*\*|__|~~)(?=\S)(.*?\S)\1/g, "$2")
      .replace(/(^|[^\w*])\*(?=\S)(.*?\S)\*(?![\w*])/g, "$1$2")
      .replace(/(^|[^\w])_(?=\S)(.*?\S)_(?!\w)/g, "$1$2")
      // eslint-disable-next-line no-control-regex
      .replace(/\u0000(\d+)\u0000/g, (_, i: string) => code[Number(i)].trim())
      .trim()
  );
};

const rawCells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split(/(?<!\\)\|/);

const cells = (line: string): string[] => rawCells(line).map(plainCell);

/** Each cell's plain text and style spans. */
const styledCells = (line: string) =>
  rawCells(line).map((c) => styledText(c.replace(/\\\|/g, "|")));

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
    const headerMarks = styledCells(lines[0]).map((c) => c.marks);
    const rowMarks = lines
      .slice(2)
      .map((l) => styledCells(l).map((c) => c.marks));
    const any =
      headerMarks.some((m) => m.length) ||
      rowMarks.some((r) => r.some((m) => m.length));
    return {
      kind: "table",
      align,
      header,
      rows,
      cols: header.length,
      cellCount: (rows.length + 1) * header.length,
      ...(any ? { headerMarks, rowMarks } : {}),
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

const EMBED = /!\[\[[^\]]+\]\]|!\[[^\]]*\]\([^)]*\)/g;

/** Line breaks as the Rust parser reports them: hard breaks always, soft ones when asked. */
const lineBreaks = (text: string, soft: boolean): string =>
  text
    .replace(/(?: {2,}|\\)\n[ \t]*/g, "\uE000")
    .replace(/[ \t]*\n[ \t]*/g, soft ? "\n" : " ")
    .replace(/\uE000/g, "\n");

/**
 * A paragraph with a picture or embed inside: text and embeds in source order, like the Rust
 * parser (a shared case table pins both). Null when the paragraph has none.
 */
const splitAtEmbeds = (
  body: string,
  range: readonly [number, number],
  soft: boolean,
): NoteBlock[] | null => {
  const found = [...body.matchAll(EMBED)];
  if (!found.length) {
    return null;
  }
  const out: NoteBlock[] = [];
  const text = (t: string) => {
    const flat = lineBreaks(t, soft).trim();
    if (flat) {
      out.push(withSpans({ kind: "paragraph" as const, text: flat, range }));
    }
  };
  let at = 0;
  for (const m of found) {
    text(body.slice(at, m.index));
    const literal = m[0];
    const image = tableOrImage(literal, range);
    if (image) {
      out.push(image);
    } else {
      const target = /^!\[\[([^\]|#]+)/.exec(literal)?.[1]?.trim();
      const md = /^!\[[^\]]*\]\(<?([^)>]+?)>?\)$/.exec(literal)?.[1]?.trim();
      out.push({
        kind: "embed",
        target: target ?? md ?? literal,
        range,
      } as NoteBlock);
    }
    at = m.index! + literal.length;
  }
  text(body.slice(at));
  return out;
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
    const split = heading
      ? null
      : splitAtEmbeds(body, range, !!options?.softBreakNewline);
    if (split) {
      blocks.push(...split);
      continue;
    }
    const flat = heading ? body : lineBreaks(body, !!options?.softBreakNewline);
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
