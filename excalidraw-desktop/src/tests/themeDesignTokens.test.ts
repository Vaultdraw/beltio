/**
 * Design-system tokens (UI redesign, PLAN.md "Token layer"): computed
 * on-primary / on-danger, the accent-as-text rule and the translucent state
 * tints, checked for ≥ 4.5:1 text contrast over every built-in theme in both
 * modes, with and without a user accent.
 */
import { describe, expect, it } from "vitest";

import {
  ACCENT_TEXT_MAX_NUDGE,
  CONTRAST,
  applyAccent,
  blendOver,
  contrastRatio,
  deriveTokens,
  loadBuiltinThemes,
  oklabDistance,
  parseThemeFile,
} from "../theme";

import type { ThemeMode, ThemeTokens } from "../theme";

const MODES: ThemeMode[] = ["dark", "light"];
const SURFACES = ["--vault-bg", "--vault-surface", "--vault-menu-bg"] as const;
const TINTS = [
  "--vault-hover",
  "--vault-chip",
  "--vault-chip-strong",
  "--vault-sel",
  "--vault-sel-strong",
] as const;

/** `rgba(r, g, b, a)` → [#rrggbb, a]. */
const parseRgba = (v: string): [string, number] => {
  const m = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(v);
  if (!m) {
    throw new Error(`not rgba: ${v}`);
  }
  const hex = `#${[m[1], m[2], m[3]]
    .map((n) => Number(n).toString(16).padStart(2, "0"))
    .join("")}`;
  return [hex, Number(m[4])];
};

const checkDesignGuarantees = (t: ThemeTokens, label: string) => {
  const min = CONTRAST.status; // 4.5
  expect(
    contrastRatio(t["--vault-on-primary"], t["--vault-primary"]),
    `${label} on-primary`,
  ).toBeGreaterThanOrEqual(min);
  expect(
    contrastRatio(t["--vault-on-danger"], t["--vault-danger"]),
    `${label} on-danger`,
  ).toBeGreaterThanOrEqual(min);
  for (const s of SURFACES) {
    expect(
      contrastRatio(t["--vault-accent-text"], t[s]),
      `${label} accent-text on ${s}`,
    ).toBeGreaterThanOrEqual(min);
    for (const tint of TINTS) {
      const [color, alpha] = parseRgba(t[tint]);
      const painted = blendOver(color, alpha, t[s]);
      expect(
        contrastRatio(t["--vault-text"], painted),
        `${label} text on ${tint} over ${s}`,
      ).toBeGreaterThanOrEqual(min);
      expect(
        contrastRatio(t["--vault-text-muted"], painted),
        `${label} muted on ${tint} over ${s}`,
      ).toBeGreaterThanOrEqual(3);
    }
  }
  // Accent text is the accent (at most a just-visible nudge) or plain text.
  const a = t["--vault-accent-text"];
  if (a !== t["--vault-text"]) {
    expect(
      oklabDistance(a, t["--vault-primary"]),
      `${label} accent-text nudge`,
    ).toBeLessThanOrEqual(ACCENT_TEXT_MAX_NUDGE);
  }
};

const ALL_BUILTINS = await loadBuiltinThemes();

describe("design tokens over every built-in theme", () => {
  const themes = ALL_BUILTINS;

  it("covers all built-ins", () => {
    expect(themes.length).toBeGreaterThanOrEqual(120);
  });

  it("keeps on-primary, on-danger, accent text and state tints readable", () => {
    for (const theme of themes) {
      for (const mode of MODES) {
        checkDesignGuarantees(
          deriveTokens(theme[mode], mode),
          `${theme.id}/${mode}`,
        );
      }
    }
  });

  it("holds with user accents too", () => {
    const accents = ["#ffeb3b", "#1e1e1e", "#e03131", "#ffffff", "#7950f2"];
    for (const theme of themes) {
      for (const mode of MODES) {
        for (const a of accents) {
          checkDesignGuarantees(
            deriveTokens(applyAccent(theme[mode], a), mode),
            `${theme.id}/${mode}+${a}`,
          );
        }
      }
    }
  });
});

describe("computed on-colours (design rule)", () => {
  it("picks the better of surface / on-surface when the palette's own fails", () => {
    // White on an ember accent fails (≈3:1): the dark surface wins.
    const theme = parseThemeFile(
      {
        dark: {
          mSurface: "#171311",
          mOnSurface: "#e6d5c2",
          mPrimary: "#ea9875",
          mOnPrimary: "#ffffff",
        },
      },
      "Ember",
    );
    const t = deriveTokens(theme.dark, "dark");
    expect(t["--vault-on-primary"]).toBe("#171311");
  });

  it("keeps the palette's own on-primary when it already reads", () => {
    const theme = parseThemeFile(
      {
        light: {
          mSurface: "#ffffff",
          mOnSurface: "#1b1b1f",
          mPrimary: "#3b63e0",
          mOnPrimary: "#ffffff",
        },
      },
      "Blue",
    );
    expect(deriveTokens(theme.light, "light")["--vault-on-primary"]).toBe(
      "#ffffff",
    );
  });

  it("falls back to on-surface for accent text when the accent is too light", () => {
    const theme = parseThemeFile(
      {
        light: {
          mSurface: "#ffffff",
          mOnSurface: "#1b1b1f",
          mPrimary: "#ffd43b",
        },
      },
      "Yellow",
    );
    const t = deriveTokens(theme.light, "light");
    expect(t["--vault-accent-text"]).toBe(t["--vault-text"]);
  });
});
