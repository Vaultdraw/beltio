/**
 * Hunter I-13 (2026-10-30). A heading (typed or imported) is drawn in the theme's heading colour
 * unless the user picked a colour of their own (roleColors.ts: "a colour picked afterwards
 * differs and wins"). The editor's black swatch (#1e1e1e, the first stroke swatch) counts as "no
 * colour of its own" (DEFAULT_STORED), so picking it for a heading changes nothing on screen: the
 * heading stays in the theme's colour. Every other swatch works, and so does a typed #000000.
 */
import { describe, expect, it } from "vitest";

import { buildRoleColor, roleTokenColor } from "../markdown/roleColors";
import { loadBuiltinThemes } from "../theme";

const themes = await loadBuiltinThemes();
// a theme variant whose h1 colour is not black, so the difference is visible
const variant = themes
  .flatMap((t) => [t.light, t.dark])
  .find((v) => {
    const c = roleTokenColor(v, "h1")?.toLowerCase();
    return c && c !== "#1e1e1e" && c !== "#000000";
  })!;

describe("hunter I-13: picking black for a heading", () => {
  const colorOf = buildRoleColor(variant, variant.mSurface);

  it("sanity: a picked red wins over the theme's heading colour", () => {
    expect(colorOf("h1", "#e03131")).toBeNull();
  });

  it("sanity: a typed #000000 wins too", () => {
    expect(colorOf("h1", "#000000")).toBeNull();
  });

  it.fails(
    "the black swatch (#1e1e1e) wins over the theme's heading colour",
    () => {
      expect(colorOf("h1", "#1e1e1e")).toBeNull();
    },
  );
});
