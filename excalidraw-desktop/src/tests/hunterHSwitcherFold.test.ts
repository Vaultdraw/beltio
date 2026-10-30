import { describe, expect, it } from "vitest";

import { prepare, score } from "../commands/fuzzy";
import { foldKey } from "../search/foldKey";

/**
 * Hunter H-2 (2026-10-30). Cmd+P (quick switcher) folds with `normalize("NFKD")` + strip marks +
 * lower case (`commands/fuzzy.ts` `fold`). Fix 6f86b1ed made tags and links use the index's fold
 * (`search/foldKey.ts`: ß, æ, œ, ø, ł, đ, ı, kana) but not the switcher, the most used search. A
 * drawing named "Łódź plan", "Straße" or "Đà Nẵng" cannot be found by typing "lodz", "strasse"
 * or "da nang"; the vault search and Obsidian's switcher find them.
 */
const hits = (query: string, name: string) =>
  score(query, prepare(`${name}.excalidraw`)) !== null;

describe("hunter H-2: the quick switcher folds like the index", () => {
  it("the index fold maps these (sanity)", () => {
    expect(foldKey("Łódź")).toBe("lodz");
    expect(foldKey("Straße")).toBe("strasse");
  });

  it.fails.each([
    ["lodz", "Łódź plan"],
    ["strasse", "Straße"],
    ["orsted", "Ørsted"],
    ["aeon", "Æon"],
    ["danang", "Đà Nẵng"],
  ])("typing %s finds %s", (query, name) => {
    expect(hits(query, name)).toBe(true);
  });
});
