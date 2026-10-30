import { describe, expect, it } from "vitest";

import { rankTags } from "../editor/tags/tagRank";
import { tagKey } from "../tags/grammar";

import type { TagCount } from "../tags/types";

/**
 * Hunter F-4 (2026-10-30). The tag pane and the `#` popup list tags by the native index's key
 * (`search/normalize.rs`: NFKD, marks dropped, lowercase AND the fold map ß->ss, æ->ae, œ->oe, ø->o,
 * ł->l, đ->d, ı->i, katakana->hiragana). The popup folds what the user typed with the TypeScript
 * twin `tagKey` (`tags/grammar.ts`), which has no fold map, so a query typed with those letters is
 * never found among keys that the native side folded.
 */
const tag = (key: string, display: string): TagCount => ({
  tag: key,
  display,
  count: 1,
});

// Keys exactly as the native `tag_key` writes them.
const NATIVE: [string, string, string][] = [
  ["Łódź", "lodz", "Łódź"],
  ["Straße", "strasse", "Straße"],
  ["Ørsted", "orsted", "Ørsted"],
  ["Æble", "aeble", "Æble"],
  ["Đà", "da", "Đà"],
  // marks the native fold keeps (never the kana voicing mark U+3099): the TS twin strips every \p{M}
  ["がっこう", "がっこう", "がっこう"],
  ["ガッコウ", "がっこう", "ガッコウ"],
];

describe("hunter F-4: the # popup finds tags typed with letters the native fold changes", () => {
  for (const [typed, key, display] of NATIVE) {
    it.fails(`typing ${typed} finds the tag stored as ${key}`, () => {
      const hits = rankTags([tag(key, display)], typed, 5);
      expect(hits.length).toBe(1);
    });
  }

  it("(context) a plain accented letter does work: Élan -> elan", () => {
    expect(tagKey("Élan")).toBe("elan");
    expect(rankTags([tag("elan", "Élan")], "Élan", 5).length).toBe(1);
  });
});
