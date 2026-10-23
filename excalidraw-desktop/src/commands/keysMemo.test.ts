import { describe, expect, it } from "vitest";

import { chordFromEvent, chordFromEventUncached } from "./keys";

import type { KeyEventLike } from "./keys";
import type { Platform } from "./types";

const CODES = [
  "",
  ...Array.from({ length: 26 }, (_, i) => `Key${String.fromCharCode(65 + i)}`),
  ...Array.from({ length: 10 }, (_, i) => `Digit${i}`),
  ...Array.from({ length: 10 }, (_, i) => `Numpad${i}`),
  ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`),
  "Comma",
  "Period",
  "Slash",
  "Backslash",
  "BracketLeft",
  "BracketRight",
  "Quote",
  "Semicolon",
  "Minus",
  "Equal",
  "Backquote",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Enter",
  "Escape",
  "Tab",
  "Space",
  "Backspace",
  "Delete",
  "Insert",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "ContextMenu",
  "NumpadAdd",
  "NumpadSubtract",
  "NumpadMultiply",
  "NumpadDivide",
  "NumpadDecimal",
  "NumpadEnter",
  "NumpadEqual",
  "ShiftLeft",
  "ShiftRight",
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
  "OSLeft",
  "CapsLock",
  "Fn",
  "IntlBackslash",
  "Unidentified",
];
const KEYS = [
  "",
  "a",
  "A",
  "z",
  "Z",
  "é",
  "ſ",
  "K",
  "ж",
  "1",
  ",",
  " ",
  "Enter",
  "Escape",
  "Dead",
  "Shift",
  "Control",
  "Alt",
  "Meta",
  "AltGraph",
  "OS",
  "CapsLock",
  "Fn",
  "ArrowUp",
  "F5",
  "+",
  "Unidentified",
  "undefined",
];
const PLATFORMS: Platform[] = ["mac", "win", "linux"];

describe("chordFromEvent memo", () => {
  it("matches the uncached function for every modifier mask, code and key", () => {
    let checked = 0;
    for (const platform of PLATFORMS) {
      for (let mask = 0; mask < 16; mask++) {
        for (const code of CODES) {
          for (const key of KEYS) {
            const e: KeyEventLike = {
              code,
              key,
              metaKey: !!(mask & 1),
              ctrlKey: !!(mask & 2),
              altKey: !!(mask & 4),
              shiftKey: !!(mask & 8),
            };
            // Twice: the second call is served from the memo.
            const expected = chordFromEventUncached(e, platform);
            expect(chordFromEvent(e, platform)).toBe(expected);
            expect(chordFromEvent(e, platform)).toBe(expected);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(100_000);
  });

  it("matches on synthetic events (empty code, meta+ctrl, missing key)", () => {
    for (const platform of PLATFORMS) {
      for (const key of ["s", "S", "Enter", "ArrowUp", "", "Shift"]) {
        const e = {
          code: "",
          key,
          metaKey: true,
          ctrlKey: true,
          altKey: false,
          shiftKey: false,
        };
        expect(chordFromEvent(e, platform)).toBe(
          chordFromEventUncached(e, platform),
        );
      }
      const noKey = { code: "", metaKey: false } as unknown as KeyEventLike;
      expect(chordFromEvent(noKey, platform)).toBe(
        chordFromEventUncached(noKey, platform),
      );
    }
  });

  it("stays correct past the memo cap", () => {
    for (let i = 0; i < 5000; i++) {
      const e = {
        code: "",
        key: `Key${i}`,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      };
      expect(chordFromEvent(e, "mac")).toBe(chordFromEventUncached(e, "mac"));
    }
  });
});
