/**
 * Validator, 2026-10-30 evening, review of 120f7db6 (toimprove 197): the quick switcher now folds
 * with the index's `foldKey`, but `prepare` calls it one code unit at a time. A name stored
 * decomposed (NFD: macOS HFS+ era files, zips and sync tools keep it) is never composed back, so
 * Korean syllables stay loose jamo and a voiced kana stays "か" + U+3099. Typing the name finds
 * nothing; before 120f7db6 it did (toimprove 214). `foldKey` on the whole name composes clusters,
 * so the vault search, link keys and the Move dialog find these names: only the switcher drifts.
 * Rows marked `it.fails` turn red when fixed: flip them then.
 */
import { describe, expect, it } from "vitest";

import { prepare, score } from "../commands/fuzzy";
import { foldKey } from "../search/foldKey";

const hits = (query: string, name: string) =>
  score(query, prepare(`${name}.excalidraw`)) !== null;

const NAMES: [query: string, name: string, broken: boolean][] = [
  ["한국", "한국 메모", true],
  ["메모", "한국 메모", true],
  ["がっこう", "がっこう", true],
  ["パン", "パン屋", true],
  ["café", "Café", false],
  ["cafe", "Café", false],
  ["strasse", "Straße", false],
];

describe("Cmd+P finds a name however it is stored (composed or decomposed)", () => {
  for (const [query, name, broken] of NAMES) {
    it(`composed ${name}: typing ${query} finds it`, () => {
      expect(hits(query, name.normalize("NFC"))).toBe(true);
    });
    (broken ? it.fails : it)(
      `decomposed ${name}: typing ${query} finds it`,
      () => {
        expect(hits(query, name.normalize("NFD"))).toBe(true);
      },
    );
    it(`the index fold treats both forms alike: ${name}`, () => {
      expect(foldKey(name.normalize("NFD"))).toBe(
        foldKey(name.normalize("NFC")),
      );
    });
  }
});
