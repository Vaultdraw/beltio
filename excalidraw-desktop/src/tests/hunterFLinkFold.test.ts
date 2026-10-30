import { describe, expect, it } from "vitest";

import { LinkResolver } from "../links/resolve";

/**
 * Hunter F-4b (2026-10-30), same family as F-4. The TS link resolver (`links/resolve.ts`, "the TS
 * twin of the Rust resolver", used for autocomplete and opening a link) says its fold is "the same
 * as the search index", but it has no fold map; the Rust resolver uses `search::normalize`
 * (ß->ss, æ->ae, œ->oe, ø->o, ł->l, đ->d, ı->i, katakana->hiragana). So a link the Rust side
 * resolves (backlinks, graph, "unresolved" list) does not open from the canvas.
 */
const files = [
  "Ørsted.excalidraw",
  "Straße.excalidraw",
  "Łódź.excalidraw",
  "Æble.excalidraw",
];
const cases: [string, string][] = [
  ["Orsted", "Ørsted.excalidraw"],
  ["Strasse", "Straße.excalidraw"],
  ["Lodz", "Łódź.excalidraw"],
  ["Aeble", "Æble.excalidraw"],
];

describe("hunter F-4b: the TS link resolver folds like the native one", () => {
  const resolver = new LinkResolver(files);
  for (const [typed, want] of cases) {
    it(`[[${typed}]] opens ${want}`, () => {
      expect(resolver.resolve("a.excalidraw", `[[${typed}]]`).path).toBe(want);
    });
  }
  it("(context) a plain accent resolves: [[Orsted]] aside, [[ELAN]] opens Élan", () => {
    const r = new LinkResolver(["Élan.excalidraw"]);
    expect(r.resolve("a.excalidraw", "[[ELAN]]").path).toBe("Élan.excalidraw");
  });
});
