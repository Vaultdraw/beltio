import { describe, expect, it } from "vitest";

import {
  LEADER_TOKEN,
  canStartInText,
  formatSequence,
  isSequenceKey,
  normalizeKey,
  normalizeKeys,
  parseSequence,
} from "./keySequence";

describe("parseSequence", () => {
  it.each([
    ["g g", ["G", "G"]],
    ["<leader> f f", ["Backslash", "F", "F"]],
    ["Mod+Alt+K Mod+S", ["Mod+Alt+K", "Mod+S"]],
    ["  g   g ", ["G", "G"]],
    ["<C-x> <A-x> <S-x>", ["Ctrl+X", "Alt+X", "Shift+X"]],
    [
      "<CR> <Esc> <Space> <Tab> <BS>",
      ["Enter", "Escape", "Space", "Tab", "Backspace"],
    ],
    ["<C-S-x> <A-CR> <C-Space>", ["Ctrl+Shift+X", "Alt+Enter", "Ctrl+Space"]],
    ["<c-x> <ESC> <Leader> g", ["Ctrl+X", "Escape", "Backslash", "G"]],
    ["<F5> g", ["F5", "G"]],
    ["<C-,>", ["Ctrl+Comma"]],
  ])("%s", (text, expected) => {
    expect(parseSequence(text, null)).toEqual(expected);
  });

  it("tries one old-style chord first, so spaced chords still parse", () => {
    expect(parseSequence("Mod + S", "mac")).toEqual(["Mod+S"]);
    expect(parseSequence("Command + Shift + =", null)).toEqual([
      "Shift+Meta+Equal",
    ]);
  });

  it("folds the platform modifier per chord", () => {
    expect(parseSequence("Cmd+K Cmd+S", "mac")).toEqual(["Mod+K", "Mod+S"]);
    expect(parseSequence("Ctrl+K Ctrl+S", "win")).toEqual(["Mod+K", "Mod+S"]);
    expect(parseSequence("Ctrl+K", "mac")).toEqual(["Ctrl+K"]);
  });

  it("expands the leader chord, or keeps the token", () => {
    expect(parseSequence("<leader> w", "mac", "Space")).toEqual(["Space", "W"]);
    expect(parseSequence("<leader> w", "mac", "<Space>")).toEqual([
      "Space",
      "W",
    ]);
    expect(parseSequence("<leader> w", "mac", LEADER_TOKEN)).toEqual([
      LEADER_TOKEN,
      "W",
    ]);
    expect(parseSequence("<leader> w", "mac", "nonsense key")).toBeNull();
  });

  it.each(["", "   ", "g nonsense", "<Nope>", "<C->", "Shift"])(
    "rejects %j",
    (text) => {
      expect(parseSequence(text, null)).toBeNull();
    },
  );

  it("is not affected by Caps Lock text: letters are case-insensitive", () => {
    expect(parseSequence("G g", null)).toEqual(["G", "G"]);
  });
});

describe("normalizeKey", () => {
  it("keeps sequences intact and the leader literal", () => {
    expect(normalizeKey("<leader> f  f", "mac")).toBe("<leader> F F");
    expect(normalizeKey("<C-x> Cmd+S", "mac")).toBe("Ctrl+X Mod+S");
    expect(normalizeKey("g g", "linux")).toBe("G G");
  });
  it("matches normalizeChord for single chords and keeps junk", () => {
    expect(normalizeKey("Cmd+s", "mac")).toBe("Mod+S");
    expect(normalizeKey("Mod + S", "mac")).toBe("Mod+S");
    expect(normalizeKey("not a key", "mac")).toBe("not a key");
  });
  it("dedupes", () => {
    expect(normalizeKeys(["g g", "G  G", "Mod+S", "Cmd+S"], "mac")).toEqual([
      "G G",
      "Mod+S",
    ]);
  });
  it("round trips through format", () => {
    const key = normalizeKey("<leader> Mod+Shift+Equal g", "mac");
    expect(key).toBe("<leader> Mod+Shift+Equal G");
    expect(parseSequence(key, "mac", "Space")).toEqual([
      "Space",
      "Mod+Shift+Equal",
      "G",
    ]);
    expect(formatSequence(key, "linux", "Space")).toBe("Space Ctrl+Shift+= G");
    expect(formatSequence("G G", "mac")).toBe("G G");
  });
  it("tells sequences from chords", () => {
    expect(isSequenceKey("G G")).toBe(true);
    expect(isSequenceKey("Mod+S")).toBe(false);
  });
});

describe("canStartInText", () => {
  it("needs Mod, Ctrl or Alt", () => {
    expect(canStartInText("G", "mac")).toBe(false);
    expect(canStartInText("Shift+G", "mac")).toBe(false);
    expect(canStartInText("Meta+G", "win")).toBe(false);
    expect(canStartInText("Mod+K", "mac")).toBe(true);
    expect(canStartInText("Mod+K", "win")).toBe(true);
    expect(canStartInText("Alt+K", "mac")).toBe(true);
    expect(canStartInText("Ctrl+K", "mac")).toBe(true);
  });
  it("treats Ctrl+Alt without Meta (AltGr) as typing", () => {
    expect(canStartInText("Ctrl+Alt+Q", "mac")).toBe(false);
    expect(canStartInText("Mod+Alt+Q", "win")).toBe(false);
    expect(canStartInText("Mod+Alt+Q", "linux")).toBe(false);
    expect(canStartInText("Mod+Ctrl+Alt+Q", "mac")).toBe(true);
    expect(canStartInText("Mod+Alt+Q", "mac")).toBe(true);
    expect(canStartInText("Alt+Q", "win")).toBe(true);
  });
});
