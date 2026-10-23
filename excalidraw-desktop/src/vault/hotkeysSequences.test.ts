import { describe, expect, it } from "vitest";

import { parseHotkeysTable } from "./settingsSync";

describe("parseHotkeysTable with key sequences", () => {
  it("keeps sequences canonical, the leader literal, and old chords", () => {
    const { hotkeys, problems } = parseHotkeysTable({
      "palette.files": ["<leader> f f", "Mod + P"],
      "list.first": ["g g", "Home"],
      "vault.newDrawing": ["<C-x> <C-s>"],
    });
    expect(problems).toEqual([]);
    expect(hotkeys["palette.files"]).toEqual(["<leader> F F", "Mod+P"]);
    expect(hotkeys["list.first"]).toEqual(["G G", "Home"]);
    expect(hotkeys["vault.newDrawing"]).toEqual(["Ctrl+X Ctrl+S"]);
  });

  it("warns on a bad sequence but keeps the rest of the list", () => {
    const { hotkeys, problems } = parseHotkeysTable({
      "list.first": ["g nonsense", "g g"],
    });
    expect(hotkeys["list.first"]).toEqual(["G G"]);
    expect(problems).toHaveLength(1);
    expect(problems[0].key).toBe("hotkeys.list.first");
    expect(problems[0].message).toContain("g nonsense");
  });
});
