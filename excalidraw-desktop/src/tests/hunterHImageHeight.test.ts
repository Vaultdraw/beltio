import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Hunter H-3 (2026-10-30). The reading view sets BOTH a width and a height attribute on a sized
 * image (`![a|1200x800](p.png)`, `![[p.png|1200x800]]`, display math in `hydrate.ts`). The only
 * rule for them is `.note-body img { max-width: 100% }` (notes.css): in a column narrower than the
 * width the browser clamps the width but keeps the height attribute, so the picture (or the
 * equation) is squashed. Needs `height: auto` next to `max-width`.
 */
const css = readFileSync(join(__dirname, "../notes/notes.css"), "utf8");
const rule = (selector: string) => {
  const m = new RegExp(
    `${selector.replace(/[.]/g, "\\.")}\\s*\\{([^}]*)\\}`,
  ).exec(css);
  return m?.[1] ?? "";
};

describe("hunter H-3: sized images keep their shape in a narrow note", () => {
  it("`.note-body img` that is clamped by max-width also has height: auto", () => {
    const body = rule(".note-body img");
    expect(body).toMatch(/max-width:\s*100%/);
    expect(body).toMatch(/height:\s*auto/);
  });
});
