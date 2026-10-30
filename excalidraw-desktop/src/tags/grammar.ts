/**
 * Tag grammar, a port of src-tauri/src/search/tags.rs (keep them in sync).
 * A tag is `#word` in a text element or frame name; offsets are UTF-16.
 */
import { foldKey } from "../search/foldKey";

export const MAX_TAG_CHARS = 64;

export type TagMatch = {
  /** UTF-16 [start, end) of `#tag` in the source text. */
  start: number;
  end: number;
  /** The tag as written, without `#`. */
  display: string;
};

export const OPENERS = new Set(["(", "[", "{", '"', "'", "<", ",", ";", ":"]);
const BODY_RUN = /[\p{Alphabetic}\p{N}_\-/̀-ͯ]*/uy;

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
  if (!/^[\p{Alphabetic}\p{N}_]/u.test(body)) {
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

/** Case/accent-folded key, the same fold as the search index (one table pins both). */
export const tagKey = (display: string) => foldKey(display);

/** True when `key` equals `filter` or lives under it (`dsa/graphs` under `dsa`). */
export const keyUnder = (key: string, filter: string) =>
  key === filter || key.startsWith(`${filter}/`);
