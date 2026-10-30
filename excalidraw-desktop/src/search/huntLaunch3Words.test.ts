import { describe, expect, it } from "vitest";

import { matchesWords, queryWords } from "./matchWords";

describe("launch hunter 3: word matching edge cases", () => {
  it("accent-folded both ways", () => {
    expect(matchesWords("cafe", "Café notes")).toBe(true);
    expect(matchesWords("café", "Cafe notes")).toBe(true);
  });
  it("words in any order", () => {
    expect(matchesWords("notes cafe", "Café notes")).toBe(true);
  });
  it("regex characters are plain text", () => {
    expect(matchesWords("(draft)", "Café (draft)")).toBe(true);
    expect(matchesWords("[a", "x [a]")).toBe(true);
    expect(matchesWords("*", "a*b")).toBe(true);
  });
  it("whitespace-only query has no words", () => {
    expect(queryWords("  \t ")).toEqual([]);
  });
  it("non-latin and emoji", () => {
    expect(matchesWords("日本", "日本語のノート")).toBe(true);
    expect(matchesWords("📝", "Café 📝")).toBe(true);
  });
  it("German sharp s and ligatures", () => {
    expect(matchesWords("strasse", "Straße")).toBe(true);
    expect(matchesWords("straße", "Strasse")).toBe(true);
  });
  it("decomposed vs precomposed accent (macOS file names are NFD)", () => {
    expect(matchesWords("café", "Café")).toBe(true);
    expect(matchesWords("café", "Café")).toBe(true);
  });
  it("dotless i / Turkish and uppercase", () => {
    expect(matchesWords("istanbul", "İstanbul")).toBe(true);
  });
});
