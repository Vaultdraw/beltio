/**
 * The `#` trigger of the text-editing autocomplete: finds an open tag token
 * before the caret (same boundary rules as src/tags/grammar.ts), ranks the
 * vault's tags, and inserts `#Display`.
 */
import {
  MAX_TAG_CHARS,
  OPENERS,
  TAG_BODY_CHAR,
  TAG_START,
} from "../../tags/grammar";
import { tagStore } from "../../tags/tagStore";
import { DEFAULT_TAGS_SETTINGS } from "../../tags/types";

import { rankTags } from "./tagRank";

import type { TagCount, TagsSettings } from "../../tags/types";
import type { InsertResult, SuggestTrigger } from "../links/wikiAutocomplete";

export type OpenTag = {
  /** Index of the `#`. */
  start: number;
  /** Text between `#` and the caret. */
  query: string;
  /** End of the token: the caret plus tag characters that follow it. */
  end: number;
};

const MAX_ROWS = 8;

function isBody(code: number): boolean {
  if (code < 128) {
    return (
      (code >= 97 && code <= 122) ||
      (code >= 65 && code <= 90) ||
      (code >= 48 && code <= 57) ||
      code === 95 ||
      code === 45 ||
      code === 47
    );
  }
  // surrogate halves: astral letters, accepted as body text
  return (
    (code >= 0xd800 && code <= 0xdfff) ||
    TAG_BODY_CHAR.test(String.fromCharCode(code))
  );
}

/** The `#tag` token the caret is at the end of (or inside), or null. */
export function findOpenTag(value: string, caret: number): OpenTag | null {
  const floor = Math.max(0, caret - MAX_TAG_CHARS - 1);
  for (let i = caret - 1; i >= floor; i--) {
    const c = value.charCodeAt(i);
    if (c !== 35) {
      if (!isBody(c)) {
        return null;
      }
      continue;
    }
    if (i > 0) {
      const prev = value[i - 1];
      if (!/\s/.test(prev) && !OPENERS.has(prev)) {
        return null;
      }
    }
    const query = value.slice(i + 1, caret);
    if (query && (!TAG_START.test(query) || query.includes("//"))) {
      return null;
    }
    let end = caret;
    while (
      end < value.length &&
      end - i <= MAX_TAG_CHARS &&
      isBody(value.charCodeAt(end))
    ) {
      end++;
    }
    return { start: i, query, end };
  }
  return null;
}

/** The text after accepting `target` (`#Display`): a space follows unless one is already there. */
export function insertTag(
  value: string,
  open: OpenTag,
  target: string,
): InsertResult {
  const before = value.slice(0, open.start) + target;
  const rest = value.slice(open.end);
  const space = rest === "" || !/^\s/.test(rest) ? " " : "";
  return { value: before + space + rest, caret: before.length + space.length };
}

export function createTagTrigger(deps: {
  getSettings?(): TagsSettings;
  getTags?(): readonly TagCount[];
}): SuggestTrigger {
  const getTags = deps.getTags ?? tagStore.get;
  return {
    enabled: () => (deps.getSettings?.() ?? DEFAULT_TAGS_SETTINGS).autocomplete,
    find: findOpenTag,
    suggest(open: OpenTag) {
      const rows = rankTags(getTags(), open.query, MAX_ROWS).map((r) => ({
        path: r.tag.display,
        positions: r.positions.map((p) => p + 1),
        target: `#${r.tag.display}`,
        count: r.tag.count,
      }));
      return { rows, create: null };
    },
    insert: (value, _caret, open: OpenTag, target) =>
      insertTag(value, open, target),
  };
}
