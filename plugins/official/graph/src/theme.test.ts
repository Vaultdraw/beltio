import { afterEach, describe, expect, it } from "vitest";

import {
  buildPalette,
  deriveGraphColours,
  FALLBACK_TOKENS,
  mixColours,
  readGraphTokens,
  rotateHue,
  toHex,
} from "./theme";
import { parseColour } from "./renderer/shared";

afterEach(() => document.documentElement.removeAttribute("style"));

describe("graph theme", () => {
  it("reads --vault-* variables and falls back for missing ones", () => {
    document.documentElement.style.setProperty("--vault-bg", "#101010");
    document.documentElement.style.setProperty("--vault-primary", " #ff8800 ");
    const t = readGraphTokens(document.documentElement);
    expect(t.bg).toBe("#101010");
    expect(t.primary).toBe("#ff8800");
    expect(t.success).toBe(FALLBACK_TOKENS.success);
  });

  it("mixes and rotates colours", () => {
    const m = parseColour(mixColours("#000000", "#ffffff", 0.5));
    expect(m[0]).toBeCloseTo(0.5, 1);
    expect(toHex(parseColour("#336699"))).toBe("#336699");
    const red = rotateHue("#ff0000", 120);
    const c = parseColour(red);
    expect(c[1]).toBeGreaterThan(c[0]); // red -> green
  });

  it("builds a folder palette of distinct colours from the tokens", () => {
    const p = buildPalette(FALLBACK_TOKENS);
    expect(p.folder.length).toBeGreaterThanOrEqual(8);
    expect(new Set(p.folder).size).toBe(p.folder.length);
    expect(p.folder[0]).toBe(FALLBACK_TOKENS.primary);
  });

  it("recolours from new tokens (dark theme) without touching structure", () => {
    const light = deriveGraphColours(FALLBACK_TOKENS);
    const dark = deriveGraphColours({
      ...FALLBACK_TOKENS,
      bg: "#121212",
      text: "#e6e6e9",
    });
    expect(dark.theme.background).toBe("#121212");
    expect(dark.theme.edge).not.toBe(light.theme.edge);
    expect(dark.palette.folder.length).toBe(light.palette.folder.length);
  });
});
