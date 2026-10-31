/**
 * Pieces of a note for `![[Note#Heading]]` and `![[Note#^block]]` embeds. Headings come from the
 * renderer's own tokens (`lexNote`), so what counts as a heading, and what is only text inside a
 * fence, a `$$` block, a `%%` or html comment, matches the reading view exactly (toimprove 311).
 */
import { lexNote, wikilinkLabel } from "./obsidian";

import type { Token, Tokens } from "marked";

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[`*_~=]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const newlines = (s: string) => (s.match(/\n/g) ?? []).length;

type Inline = Token & { tokens?: Token[]; text?: string; inner?: string };

/** The text a heading shows in the reading view, without its markup. */
function shownText(tokens: Token[] | undefined): string {
  let out = "";
  for (const t of (tokens ?? []) as Inline[]) {
    if (t.type === "wikilink") {
      out += wikilinkLabel(t.inner ?? "");
    } else if (
      t.type === "html" ||
      t.type === "notecomment" ||
      t.type === "noteblockid" ||
      t.type === "footnoteref"
    ) {
      continue;
    } else if (t.type === "br") {
      out += " ";
    } else if (t.tokens) {
      out += shownText(t.tokens);
    } else if (
      t.type === "text" ||
      t.type === "escape" ||
      t.type === "codespan"
    ) {
      out += t.text ?? "";
    } else {
      out += t.raw;
    }
  }
  return out;
}

/** A piece of a note and the line (0-based) of the note it starts on. */
export interface Located {
  line: number;
  text: string;
}

/** The heading's line through the line before the next heading of the same or a higher level. */
export const extractSection = (text: string, heading: string): string | null =>
  locateSection(text, heading)?.text ?? null;

/** `extractSection` with the line the section starts on, so a task in it can be found in the file. */
export function locateSection(text: string, heading: string): Located | null {
  const src = text.replace(/\r\n?/g, "\n");
  const { tokens, skipped } = lexNote(src, true);
  const lines = src.split("\n");
  const want = norm(heading);
  let line = skipped;
  let start = -1;
  let level = 0;
  for (const t of tokens) {
    if (t.type === "heading") {
      const h = t as Tokens.Heading;
      if (start < 0) {
        if (norm(shownText(h.tokens)) === want) {
          start = line;
          level = h.depth;
        }
      } else if (h.depth <= level) {
        return {
          line: start,
          text: lines.slice(start, line).join("\n").trimEnd(),
        };
      }
    }
    line += newlines(t.raw);
  }
  return start < 0
    ? null
    : { line: start, text: lines.slice(start).join("\n").trimEnd() };
}

/**
 * The paragraph or list item whose last words are `^id`, without the marker. An id on a line of
 * its own names the block above it (a table, quote or list, after a blank line), as in Obsidian.
 */
export const extractBlock = (text: string, id: string): string | null =>
  locateBlock(text, id)?.text ?? null;

/** `extractBlock` with the line the block starts on. */
export function locateBlock(text: string, id: string): Located | null {
  const lines = text.split(/\r?\n/);
  const marker = new RegExp(
    `(?:^|\\s)\\^${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`,
  );
  for (let i = 0; i < lines.length; i++) {
    if (!marker.test(lines[i])) {
      continue;
    }
    if (lines[i].trim() === `^${id}`) {
      let end = i - 1;
      while (end >= 0 && lines[end].trim() === "") {
        end--;
      }
      if (end < 0) {
        return null;
      }
      let start = end;
      while (start > 0 && lines[start - 1].trim() !== "") {
        start--;
      }
      return { line: start, text: lines.slice(start, end + 1).join("\n") };
    }
    let from = i;
    while (
      from > 0 &&
      lines[from - 1].trim() !== "" &&
      !/^\s*([-*+]|\d+[.)])\s/.test(lines[from])
    ) {
      from--;
    }
    const block = lines.slice(from, i + 1);
    block[block.length - 1] = block[block.length - 1].replace(marker, "");
    return { line: from, text: block.join("\n") };
  }
  return null;
}
