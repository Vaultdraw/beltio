import { describe, expect, it } from "vitest";

import { loadBuiltinThemes } from "../theme";
import { contrastRatio } from "../theme/color";
import { CONTRAST, deriveTokens } from "../theme/tokens";

// Cendre omits mHover/mOnHover/mShadow. The navigator's hover, chip and
// selected tints and its accent icon come from on-surface and primary, so they
// must still be readable in every depth and mode.
// Built-in themes load on demand: resolve them once, before the cases are made.
const cendres = (await loadBuiltinThemes()).filter((t) =>
  t.id.startsWith("cendre"),
);

describe("Cendre navigator tokens", () => {
  it("loads the three depths", () => {
    expect(cendres).toHaveLength(3);
  });

  for (const t of cendres) {
    for (const mode of ["dark", "light"] as const) {
      it(`${t.id} ${mode}: tints derive from the palette and stay readable`, () => {
        const k = deriveTokens(t[mode], mode);
        const rgb = (hex: string) => {
          const n = parseInt(hex.slice(1, 7), 16);
          return `${n >> 16}, ${(n >> 8) & 255}, ${n & 255}`;
        };
        // Tints derive from the effective (contrast-adjusted) text and primary.
        expect(k["--vault-hover"]).toContain(rgb(k["--vault-text"]));
        expect(k["--vault-chip"]).toContain(rgb(k["--vault-text"]));
        expect(k["--vault-sel"]).toContain(rgb(k["--vault-primary"]));
        expect(
          contrastRatio(k["--vault-text"], k["--vault-bg"]),
        ).toBeGreaterThanOrEqual(CONTRAST.status);
        expect(
          contrastRatio(k["--vault-accent-text"], k["--vault-bg"]),
        ).toBeGreaterThanOrEqual(CONTRAST.status);
        expect(
          contrastRatio(k["--vault-accent-text"], k["--vault-surface"]),
        ).toBeGreaterThanOrEqual(CONTRAST.status);
      });
    }
  }
});
