/**
 * The tag grammar: what counts as a `#tag` in a text. The app (`tags/grammar.ts`, the search index's
 * port of `search/tags.rs`, the reading view, the note editor) and the plugin API's note parse
 * stand-in (`shared/markdown.ts`) all call this one function, so they give the same answers. One case
 * table pins it against the Rust index. Offsets are UTF-16.
 */
export const MAX_TAG_CHARS = 64;

export type TagMatch = {
  /** UTF-16 [start, end) of `#tag` in the source text. */
  start: number;
  end: number;
  /** The tag as written, without `#`. */
  display: string;
};

export const OPENERS = new Set(["(", "[", "{", '"', "'", "<", ",", ";", ":"]);
/** One character of a tag's body; the first one must also match `TAG_START`. */
export const TAG_BODY_CHAR = /[\p{Alphabetic}\p{N}_\-/̀-ͯ]/u;
export const TAG_START = /^[\p{Alphabetic}\p{N}_]/u;
const BODY_RUN = new RegExp(`${TAG_BODY_CHAR.source}*`, "uy");

const opensTag = (prev: string | undefined) =>
  prev === undefined || /\s/.test(prev) || OPENERS.has(prev);

const isHexColour = (body: string) =>
  [3, 4, 6, 8].includes(body.length) &&
  /^[0-9a-f]+$/i.test(body) &&
  /\d/.test(body);

/** Validates and trims a raw run; returns the accepted body or null. */
function accept(raw: string): string | null {
  const cut = raw.indexOf("//");
  const body = (cut < 0 ? raw : raw.slice(0, cut)).replace(/[-/]+$/, "");
  if (!TAG_START.test(body)) {
    return null;
  }
  if ([...body].length > MAX_TAG_CHARS) {
    return null;
  }
  if (!/\p{Alphabetic}/u.test(body) || isHexColour(body)) {
    return null;
  }
  return body;
}

/** All tags in `text`, in order (duplicates kept). */
export function findTags(text: string): TagMatch[] {
  const out: TagMatch[] = [];
  for (let i = text.indexOf("#"); i >= 0; i = text.indexOf("#", i + 1)) {
    if (!opensTag(i > 0 ? text[i - 1] : undefined)) {
      continue;
    }
    BODY_RUN.lastIndex = i + 1;
    const body = accept(BODY_RUN.exec(text)?.[0] ?? "");
    if (body) {
      out.push({ start: i, end: i + 1 + body.length, display: body });
    }
  }
  return out;
}
