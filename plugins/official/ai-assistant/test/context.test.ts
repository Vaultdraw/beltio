import { describe, expect, it } from "vitest";

import { describeElements, pickElements, textOf } from "../src/context";

import type { SceneElement } from "@vaultdraw/api";

const el = (id: string, over: Partial<SceneElement> = {}): SceneElement => ({
  id,
  type: "rectangle",
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  angle: 0,
  ...over,
});

describe("context", () => {
  it("the selection wins over the drawing; a stale selection falls back to the drawing", () => {
    const all = [el("a"), el("b")];
    expect(pickElements(all, ["b"])).toEqual({
      elements: [all[1]],
      scope: "selection",
    });
    expect(pickElements(all, []).scope).toBe("drawing");
    expect(pickElements(all, ["gone"]).scope).toBe("drawing");
  });

  it("describes elements with labels and positions, collapsing whitespace", () => {
    const c = describeElements(
      [el("a", { type: "text", text: "Hello\n  world", x: 4.6, y: 1 })],
      1000,
    );
    expect(c.text).toBe('- text "Hello world" at (5, 1) size 10x10');
    expect(c.summary).toBe("1 element, 1 with text");
    expect(c.cut).toBe(0);
  });

  it("stays under the limit on a whole line and says how much was cut", () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      el(`e${i}`, { type: "text", text: `item ${i}` }),
    );
    const c = describeElements(many, 500);
    expect(c.text.length).toBeLessThanOrEqual(500);
    expect(
      c.text.endsWith("\n") || /\d\)? size \d+x\d+$/.test(c.text.trimEnd()),
    ).toBe(true);
    expect(c.cut).toBeGreaterThan(0);
  });

  it("text only: reading order, empty texts left out", () => {
    const c = textOf(
      [
        el("b", { text: "second", y: 50 }),
        el("a", { text: "first", y: 10 }),
        el("c", { text: "  " }),
        el("d"),
      ],
      1000,
    );
    expect(c.text).toBe("first\n\nsecond");
    expect(c.summary).toBe("2 pieces of text");
  });

  it("odd text: emoji, long line, quotes", () => {
    const c = describeElements(
      [el("a", { type: "text", text: `say "hi" 🙂 ${"x".repeat(300)}` })],
      5000,
    );
    expect(c.text).toContain("🙂");
  });
});
