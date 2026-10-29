/**
 * Markdown colours of themes (toimprove #111, owner 2026-10-30: "it should be according to the
 * theme we are using; Obsidian adapts these to the theme"). Each theme gives every Markdown role
 * (h1 … h6, bold, italic, link, code, code background, quote bar) a colour, its own or derived
 * from its palette; imported elements store a role colour that the canvas draws in the active
 * theme's colour; switching themes restyles them.
 */
import { describe, expect, it } from "vitest";

import { COLOR_PALETTE } from "@excalidraw/common";

import {
  MARKDOWN_ROLES,
  ROLE_COLORS,
} from "../../../sdk/api/shared/markdownRoles";
import { FILL_COLORS, TONE_COLORS } from "../../../sdk/api/shared/pageItems";
import {
  MARKDOWN_TEXT_CONTRAST,
  buildCanvasPaletteMap,
  contrastRatio,
  deriveMarkdownColors,
  deriveTokens,
  loadBuiltinThemes,
  markdownColors,
  markdownToken,
  parseThemeFile,
} from "../theme";

import type { ThemeMode } from "../theme";

const themes = await loadBuiltinThemes();
const MODES: ThemeMode[] = ["light", "dark"];
const cases = themes.flatMap((t) => MODES.map((m) => [t.id, m] as const));
const variant = (id: string, mode: ThemeMode) =>
  themes.find((t) => t.id === id)![mode];

describe("role colours in the file", () => {
  it("are distinct, and none is a colour of the editor's picker", () => {
    const values = Object.values(ROLE_COLORS);
    expect(new Set(values).size).toBe(values.length);
    const picker = new Set(
      Object.values(COLOR_PALETTE)
        .flat()
        .map((c) => String(c).toLowerCase()),
    );
    for (const c of values) {
      expect(picker.has(c), c).toBe(false);
    }
  });

  it("read on plain white paper (Normal page, exports)", () => {
    for (const role of MARKDOWN_ROLES) {
      if (role === "code_bg" || role === "quote_bar") {
        continue;
      }
      expect(
        contrastRatio(ROLE_COLORS[role], "#ffffff"),
        role,
      ).toBeGreaterThanOrEqual(MARKDOWN_TEXT_CONTRAST);
    }
  });
});

describe("derived Markdown colours (a theme that sets none)", () => {
  it.each(cases)(
    "%s (%s): text roles read at 4.5:1 on the page",
    (id, mode) => {
      const v = variant(id, mode);
      const md = deriveMarkdownColors(v);
      for (const role of MARKDOWN_ROLES) {
        if (role === "code_bg") {
          continue;
        }
        const min = role === "quote_bar" ? 3 : MARKDOWN_TEXT_CONTRAST;
        expect(
          contrastRatio(md[role], v.mSurface),
          `${role} ${md[role]} on ${v.mSurface}`,
        ).toBeGreaterThanOrEqual(min - 0.01);
      }
    },
  );

  it("come from the theme's own colours: headings start at the accent", () => {
    const theme = parseThemeFile(
      {
        name: "Plain",
        dark: {
          mSurface: "#101010",
          mOnSurface: "#eeeeee",
          mPrimary: "#7aa2f7",
        },
      },
      "plain",
    );
    const md = markdownColors(theme.dark);
    expect(md.h1).toBe("#7aa2f7");
    expect(md.link).toBe("#7aa2f7");
    expect(md.bold).toBe("#eeeeee");
  });
});

describe("a theme's own Markdown colours", () => {
  const file = (markdown: unknown) => ({
    name: "Mine",
    light: {
      mSurface: "#ffffff",
      mOnSurface: "#222222",
      mPrimary: "#0055cc",
      markdown,
    },
  });

  it("are used as written, even at low contrast (the author's choice)", () => {
    const theme = parseThemeFile(file({ h1: "#ffcc00", link: "#ff00aa" }), "m");
    const md = markdownColors(theme.light);
    expect(md.h1).toBe("#ffcc00");
    expect(md.link).toBe("#ff00aa");
    // The rest are derived.
    expect(md.h2).toBe(deriveMarkdownColors(theme.light).h2);
    expect(theme.warnings).toEqual(["dark: generated from the light variant"]);
  });

  it("an unknown role or a bad colour is a warning, not an error", () => {
    const theme = parseThemeFile(file({ h7: "#000000", h2: "blue" }), "m");
    expect(theme.warnings).toContain("light.markdown.h7: unknown key ignored");
    expect(theme.warnings).toContain(
      "light.markdown.h2 must be a hex colour; ignored",
    );
  });

  it("a generated variant derives its own (never the other mode's)", () => {
    const theme = parseThemeFile(file({ h1: "#123456" }), "m");
    expect(theme.dark.markdown).toBeUndefined();
  });
});

describe("the canvas and the tokens draw roles in the theme's colours", () => {
  it.each(cases)("%s (%s)", (id, mode) => {
    const v = variant(id, mode);
    const map = buildCanvasPaletteMap(v);
    const md = markdownColors(v);
    const tokens = deriveTokens(v, mode) as Record<string, string>;
    for (const role of MARKDOWN_ROLES) {
      expect(map.get(ROLE_COLORS[role]), role).toBe(md[role]);
      expect(tokens[markdownToken(role)], role).toBe(md[role]);
    }
  });
});

/** Each construct of an imported note, the colour it stores, and the role the theme paints it with. */
const CONSTRUCTS: Array<[string, string, keyof typeof ROLE_COLORS]> = [
  ["heading 1", TONE_COLORS.heading1, "h1"],
  ["heading 2", TONE_COLORS.heading2, "h2"],
  ["heading 3", TONE_COLORS.heading3, "h3"],
  ["heading 4", TONE_COLORS.heading4, "h4"],
  ["heading 5", TONE_COLORS.heading5, "h5"],
  ["heading 6", TONE_COLORS.heading6, "h6"],
  ["link", TONE_COLORS.link, "link"],
  ["code text", TONE_COLORS.code, "code"],
  ["code box", FILL_COLORS.code, "code_bg"],
  ["quote bar", FILL_COLORS.bar, "quote_bar"],
];
const TWO_THEMES = ["catppuccin", "nord"];

describe("each construct takes its theme colour (2 themes, light and dark)", () => {
  const rows = CONSTRUCTS.flatMap((c) =>
    TWO_THEMES.flatMap((id) => MODES.map((m) => [...c, id, m] as const)),
  );
  it.each(rows)("%s in %s %s", (_name, stored, role, id, mode) => {
    const v = variant(id, mode);
    expect(buildCanvasPaletteMap(v).get(stored)).toBe(markdownColors(v)[role]);
  });

  it("switching themes restyles the same file", () => {
    const shown = TWO_THEMES.map((id) =>
      buildCanvasPaletteMap(variant(id, "dark")).get(TONE_COLORS.heading1),
    );
    expect(shown[0]).not.toBe(shown[1]);
  });
});

describe("the stock Default theme's CSS", () => {
  it("has the Default theme's Markdown colours (light and dark)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const css = fs.readFileSync(
      path.join(__dirname, "../theme/designSystem.css"),
      "utf8",
    );
    const dark = css.slice(css.indexOf("html.dark {"));
    const light = css.slice(0, css.indexOf("html.dark {"));
    const def = themes.find((t) => t.id === "default")!;
    for (const [block, mode] of [
      [light, "light"],
      [dark, "dark"],
    ] as const) {
      const md = markdownColors(def[mode]);
      for (const role of MARKDOWN_ROLES) {
        expect(block, `${mode} ${role}`).toContain(
          `${markdownToken(role)}: ${md[role]};`,
        );
      }
    }
  });
});
