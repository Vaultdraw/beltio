/**
 * One path from role to colour (toimprove 124): a heading imported from a note and a heading
 * typed in Markdown mode store the role the same way (`customData.role`) and are drawn in the
 * same colour: the active theme's `markdown` token for that role.
 */
import { describe, expect, it } from "vitest";

import { buildPageElements } from "../../../sdk/api/shared/pageItems";
import { buildRoleColor, roleTokenColor } from "../markdown/roleColors";
import { buildCanvasPaletteMap } from "../theme/canvas";
import { ensureContrast } from "../theme/color";
import { HEADING_ROLES, roleOf, withRole } from "../markdown/roles";
import { loadBuiltinThemes, markdownColors } from "../theme";

import type { PageItem } from "../../../sdk/api/src/pages";
import type { ThemeMode, ThemeVariant } from "../theme";

const themes = await loadBuiltinThemes();
const MODES: ThemeMode[] = ["light", "dark"];
const pairs = ["default", themes[1].id].flatMap((id) =>
  MODES.map((m) => [id, m] as const),
);
const variantOf = (id: string, mode: ThemeMode): ThemeVariant =>
  (themes.find((t) => t.id === id) ?? themes[0])[mode];

let n = 0;
const importedHeading = (level: number) => {
  const item = {
    type: "text",
    page: 0,
    x: 0,
    y: 0,
    width: 100,
    height: 20,
    text: "Title",
    fontSize: 20,
    fontFamily: "sans",
    tone: `heading${level}`,
    data: { heading: level, role: `h${level}` },
  } as unknown as PageItem;
  const { elements } = buildPageElements([item], {
    dataKey: "plugins.markdown-import",
    id: () => `id${n++}`,
    seed: () => 1,
    now: () => 1,
  });
  return elements[0] as {
    strokeColor: string;
    customData?: Record<string, unknown>;
  };
};
const typedHeading = (level: number) => ({
  strokeColor: "#1e1e1e",
  customData: withRole(undefined, `h${level}`),
});

describe("imported and typed headings", () => {
  it("store the role in the same place", () => {
    for (const level of [1, 2, 3, 4, 5, 6]) {
      expect(roleOf(importedHeading(level)), `h${level}`).toBe(`h${level}`);
      expect(roleOf(typedHeading(level))).toBe(`h${level}`);
    }
  });

  it.each(pairs)("%s (%s): look the same", (id, mode) => {
    const v = variantOf(id, mode);
    const resolve = buildRoleColor(v, v.mSurface);
    for (const level of [1, 2, 3, 4, 5, 6]) {
      const a = importedHeading(level);
      const b = typedHeading(level);
      const ca = resolve(roleOf(a)!, a.strokeColor);
      const cb = resolve(roleOf(b)!, b.strokeColor);
      expect(ca, `h${level}`).toBe(cb);
      expect(ca).toBe(markdownColors(v)[`h${level}` as "h1"]);
    }
  });

  it("a theme that sets markdown.h2 changes both", () => {
    const v = variantOf("default", "dark");
    const mine = { ...v, markdown: { h2: "#ff0000" } } as ThemeVariant;
    const before = buildRoleColor(v, v.mSurface);
    const after = buildRoleColor(mine, mine.mSurface);
    for (const el of [importedHeading(2), typedHeading(2)]) {
      expect(after("h2", el.strokeColor)).toBe("#ff0000");
      expect(before("h2", el.strokeColor)).not.toBe("#ff0000");
    }
    expect(after("h3", "#1e1e1e")).toBe(before("h3", "#1e1e1e"));
  });

  it("keep a colour the user picked", () => {
    const v = variantOf("default", "light");
    const resolve = buildRoleColor(v, v.mSurface);
    expect(resolve("h2", "#e03131")).toBeNull();
  });

  it("move to readable colours when the canvas is not the theme's page", () => {
    const v = variantOf("default", "dark");
    const onWhite = buildRoleColor(v, "#ffffff");
    for (const role of HEADING_ROLES) {
      const c = onWhite(role, "#1e1e1e")!;
      expect(c).toMatch(/^#[0-9a-f]{6}$/i);
      expect(roleTokenColor(v, role)).toBeTruthy();
    }
  });
});

// Family: every Markdown role colour follows the theme, in every theme, light and dark,
// whether or not the canvas syncs with the theme (toimprove 163).
describe("every role colour follows the active theme", () => {
  const ROLES = [
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "quote",
    "link",
    "code",
    "bold",
    "italic",
  ];
  const everyVariant = themes.flatMap((t) =>
    MODES.map((m) => [`${t.id} ${m}`, t[m]] as const),
  );

  it.each(everyVariant)(
    "%s: on the theme's page each role is its token",
    (_n, v) => {
      const resolve = buildRoleColor(v, v.mSurface);
      for (const role of ROLES) {
        const token = roleTokenColor(v, role);
        expect(token, role).toMatch(/^#[0-9a-f]{6}$/i);
        expect(resolve(role, "#1e1e1e"), role).toBe(token);
      }
      for (const r of [
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "link",
        "code",
        "bold",
        "italic",
      ] as const) {
        expect(roleTokenColor(v, r), r).toBe(markdownColors(v)[r]);
      }
    },
  );

  it.each(everyVariant)(
    "%s: off the theme's page each role reads at 4.5:1",
    (_n, v) => {
      for (const canvas of ["#ffffff", "#121212"]) {
        if (canvas === v.mSurface) {
          continue; // the theme's own page: its colours as written
        }
        const resolve = buildRoleColor(v, canvas);
        for (const role of ROLES) {
          const got = resolve(role, "#1e1e1e")!;
          expect(got, `${role} on ${canvas}`).toBe(
            ensureContrast(roleTokenColor(v, role)!, canvas, 4.5),
          );
        }
      }
    },
  );

  it.each(everyVariant)(
    "%s: a typed quote is the colour an imported quote gets",
    (_n, v) => {
      // the import draws a quote's text in its muted tone (gray 600), which the theme paints
      expect(roleTokenColor(v, "quote")).toBe(
        buildCanvasPaletteMap(v).get("#868e96"),
      );
    },
  );

  it("a user's own text colour does not hide the role colour, a later pick does", () => {
    const v = variantOf("default", "dark");
    const resolve = buildRoleColor(v, v.mSurface);
    const heading = withRole(undefined, "h1", "#E03131")!;
    expect(heading.roleBase).toBe("#e03131");
    // stored colour is still the one the box had: the theme's colour applies
    expect(resolve("h1", "#E03131", heading.roleBase as string)).toBe(
      markdownColors(v).h1,
    );
    // the user then picked another colour: it wins, the role no longer applies
    expect(resolve("h1", "#2f9e44", heading.roleBase as string)).toBeNull();
    // without a base (an older file) a coloured heading keeps its colour
    expect(resolve("h1", "#E03131")).toBeNull();
  });

  it("withRole(null) removes the role and its base; other data stays", () => {
    const set = withRole({ other: 1 }, "h2", "#e03131");
    expect(set).toEqual({ other: 1, role: "h2", roleBase: "#e03131" });
    expect(withRole(set, null)).toEqual({ other: 1 });
    expect(withRole({ role: "h2", roleBase: "#e03131" }, null)).toBeUndefined();
  });
});
