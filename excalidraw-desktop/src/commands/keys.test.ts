import { describe, expect, it } from "vitest";

import {
  chordFromEvent,
  detectPlatform,
  formatChordWords,
  formatChord,
  isModifierFree,
  normalizeChord,
  parseChord,
} from "./keys";

describe("detectPlatform", () => {
  const fake = (platform: string, userAgent = "") =>
    ({ navigator: { platform, userAgent } } as unknown as Window);
  it("maps navigator strings", () => {
    expect(detectPlatform(fake("MacIntel"))).toBe("mac");
    expect(
      detectPlatform(fake("", "Mozilla/5.0 (Macintosh; Intel Mac OS X)")),
    ).toBe("mac");
    expect(detectPlatform(fake("Win32"))).toBe("win");
    expect(detectPlatform(fake("Linux x86_64"))).toBe("linux");
    expect(detectPlatform(fake("", "Mozilla/5.0 (X11; Linux x86_64)"))).toBe(
      "linux",
    );
    expect(detectPlatform(fake("", "Mozilla/5.0 (darwin) jsdom"))).toBe("mac");
  });
});

describe("parseChord", () => {
  it.each([
    ["mod+s", "Mod+S"],
    ["Cmd+S", "Meta+S"],
    ["⌘⇧=", null],
    ["Command + Shift + =", "Shift+Meta+Equal"],
    ["CmdOrCtrl+,", "Mod+Comma"],
    ["CommandOrControl+Shift+Plus", "Mod+Shift+Equal"],
    ["Control+Option+N", "Ctrl+Alt+N"],
    ["Opt+Shift+Ctrl+Mod+n", "Mod+Ctrl+Alt+Shift+N"],
    ["Mod+0", "Mod+0"],
    ["Mod+Digit0", "Mod+0"],
    ["Mod+KeyN", "Mod+N"],
    ["Mod+\\", "Mod+Backslash"],
    ["Mod+[", "Mod+BracketLeft"],
    ["Mod+]", "Mod+BracketRight"],
    ["Mod+'", "Mod+Quote"],
    ["Mod+;", "Mod+Semicolon"],
    ["Mod+.", "Mod+Period"],
    ["Mod+/", "Mod+Slash"],
    ["Mod+`", "Mod+Backquote"],
    ["Mod+-", "Mod+Minus"],
    ["Mod++", "Mod+Equal"],
    ["f2", "F2"],
    ["F24", "F24"],
    ["esc", "Escape"],
    ["Mod+up", "Mod+ArrowUp"],
    ["Mod+Numpad0", "Mod+Numpad0"],
    ["Shift+NumpadAdd", "Shift+NumpadAdd"],
    ["Mod+Shift+Space", "Mod+Shift+Space"],
  ])("%s -> %s", (text, expected) => {
    expect(parseChord(text)).toBe(expected);
  });

  it.each([
    "",
    " ",
    "Mod",
    "Mod+Shift",
    "Mod+S+D",
    "Mod+Nope",
    "Mod+",
    "+S",
    "Mod+F25",
    "S+",
  ])("rejects %j", (text) => {
    expect(parseChord(text)).toBeNull();
  });

  it("round-trips canonical chords", () => {
    for (const c of [
      "Mod+Shift+Equal",
      "Mod+Comma",
      "F2",
      "Alt+N",
      "Mod+Shift+0",
    ]) {
      expect(parseChord(c)).toBe(c);
    }
  });
});

describe("normalizeChord", () => {
  it("folds the primary modifier into Mod", () => {
    expect(normalizeChord("Meta+S", "mac")).toBe("Mod+S");
    expect(normalizeChord("Ctrl+S", "mac")).toBe("Ctrl+S");
    expect(normalizeChord("Ctrl+S", "win")).toBe("Mod+S");
    expect(normalizeChord("Meta+S", "win")).toBe("Meta+S");
    expect(normalizeChord("Cmd+Shift+=", "mac")).toBe("Mod+Shift+Equal");
    expect(normalizeChord("Mod+S", "linux")).toBe("Mod+S");
    expect(normalizeChord("garbage+", "mac")).toBe("garbage+");
  });
});

describe("chordFromEvent", () => {
  const ev = (init: Partial<Record<string, unknown>>) =>
    ({
      code: "",
      key: "",
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      ...init,
    } as Parameters<typeof chordFromEvent>[0]);

  it("plain letters follow the layout; modified ones the physical key", () => {
    // Dvorak: the key at QWERTY C types j.
    expect(chordFromEvent(ev({ code: "KeyC", key: "j" }), "mac")).toBe("J");
    expect(
      chordFromEvent(ev({ code: "KeyC", key: "J", shiftKey: true }), "mac"),
    ).toBe("Shift+J");
    // AZERTY: the key at QWERTY Q types a.
    expect(chordFromEvent(ev({ code: "KeyQ", key: "a" }), "win")).toBe("A");
    expect(
      chordFromEvent(ev({ code: "KeyC", key: "j", metaKey: true }), "mac"),
    ).toBe("Mod+C");
    // Non-Latin layouts keep the physical key.
    expect(chordFromEvent(ev({ code: "KeyJ", key: "о" }), "mac")).toBe("J");
  });

  it("uses code, per platform", () => {
    const e = ev({ code: "KeyS", key: "s", metaKey: true });
    expect(chordFromEvent(e, "mac")).toBe("Mod+S");
    expect(chordFromEvent(e, "win")).toBe("Meta+S");
    const c = ev({ code: "KeyS", key: "s", ctrlKey: true });
    expect(chordFromEvent(c, "win")).toBe("Mod+S");
    expect(chordFromEvent(c, "mac")).toBe("Ctrl+S");
  });

  it("uses layout-independent codes", () => {
    expect(
      chordFromEvent(
        ev({ code: "Equal", key: "+", metaKey: true, shiftKey: true }),
        "mac",
      ),
    ).toBe("Mod+Shift+Equal");
    expect(
      chordFromEvent(
        ev({ code: "Digit0", key: "0", ctrlKey: true, shiftKey: true }),
        "win",
      ),
    ).toBe("Mod+Shift+0");
    expect(
      chordFromEvent(ev({ code: "Comma", key: ",", metaKey: true }), "mac"),
    ).toBe("Mod+Comma");
    expect(
      chordFromEvent(
        ev({ code: "Numpad0", key: "0", metaKey: true, shiftKey: true }),
        "mac",
      ),
    ).toBe("Mod+Shift+Numpad0");
  });

  it("orders modifiers canonically", () => {
    expect(
      chordFromEvent(
        ev({
          code: "KeyN",
          key: "n",
          metaKey: true,
          ctrlKey: true,
          altKey: true,
          shiftKey: true,
        }),
        "mac",
      ),
    ).toBe("Mod+Ctrl+Alt+Shift+N");
  });

  it("returns null for modifier-only and unknown keys", () => {
    expect(
      chordFromEvent(
        ev({ code: "ShiftLeft", key: "Shift", shiftKey: true }),
        "mac",
      ),
    ).toBeNull();
    expect(
      chordFromEvent(
        ev({ code: "MetaRight", key: "Meta", metaKey: true }),
        "mac",
      ),
    ).toBeNull();
    expect(
      chordFromEvent(ev({ key: "Control", ctrlKey: true }), "win"),
    ).toBeNull();
    expect(
      chordFromEvent(
        ev({ code: "AudioVolumeUp", key: "AudioVolumeUp" }),
        "mac",
      ),
    ).toBeNull();
    expect(chordFromEvent(ev({ key: "Dead" }), "mac")).toBeNull();
  });

  it("derives from key when code is empty (synthetic events)", () => {
    // smoke/perf scripts set both meta and ctrl and no code
    for (const platform of ["mac", "win", "linux"] as const) {
      expect(
        chordFromEvent(
          ev({ key: "s", metaKey: true, ctrlKey: true }),
          platform,
        ),
      ).toBe("Mod+S");
      expect(
        chordFromEvent(
          ev({ key: "A", metaKey: true, ctrlKey: true }),
          platform,
        ),
      ).toBe("Mod+A");
    }
    expect(chordFromEvent(ev({ key: "r" }), "mac")).toBe("R");
    expect(chordFromEvent(ev({ key: "s", metaKey: true }), "mac")).toBe(
      "Mod+S",
    );
    expect(chordFromEvent(ev({ key: "Enter" }), "mac")).toBe("Enter");
    expect(chordFromEvent(ev({ key: "Escape" }), "mac")).toBe("Escape");
  });
});

describe("formatChord", () => {
  it("formats for mac", () => {
    expect(formatChord("Mod+Shift+Equal", "mac")).toBe("⇧⌘=");
    expect(formatChord("Mod+Comma", "mac")).toBe("⌘,");
    expect(formatChord("Mod+Ctrl+Alt+Shift+N", "mac")).toBe("⌃⌥⇧⌘N");
    expect(formatChord("F2", "mac")).toBe("F2");
    expect(formatChord("Mod+Backslash", "mac")).toBe("⌘\\");
    expect(formatChord("Mod+Shift+Numpad0", "mac")).toBe("⇧⌘Num 0");
  });
  it("formats for win/linux", () => {
    expect(formatChord("Mod+Shift+Equal", "win")).toBe("Ctrl+Shift+=");
    expect(formatChord("Mod+Comma", "linux")).toBe("Ctrl+,");
    expect(formatChord("Alt+N", "win")).toBe("Alt+N");
    expect(formatChord("Mod+Enter", "win")).toBe("Ctrl+Enter");
    expect(formatChord("Meta+E", "win")).toBe("Meta+E");
  });
});

describe("isModifierFree", () => {
  it("treats Shift alone as free", () => {
    expect(isModifierFree("N")).toBe(true);
    expect(isModifierFree("Shift+N")).toBe(true);
    expect(isModifierFree("F2")).toBe(true);
    expect(isModifierFree("Mod+N")).toBe(false);
    expect(isModifierFree("Alt+N")).toBe(false);
    expect(isModifierFree("Ctrl+N")).toBe(false);
    expect(isModifierFree("Meta+N")).toBe(false);
  });
});

describe("formatChordWords", () => {
  it("uses Excalidraw's word style per platform", () => {
    expect(formatChordWords("Mod+Comma", "mac")).toBe("Cmd+,");
    expect(formatChordWords("Mod+Alt+KeyJ", "mac")).toBe("Cmd+Option+J");
    expect(formatChordWords("Mod+Shift+KeyE", "mac")).toBe("Cmd+Shift+E");
    expect(formatChordWords("Mod+Alt+KeyJ", "win")).toBe("Ctrl+Alt+J");
  });
});
