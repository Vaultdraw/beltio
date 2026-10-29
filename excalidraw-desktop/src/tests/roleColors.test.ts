/**
 * One path from role to colour (toimprove 124): a heading imported from a note and a heading
 * typed in Markdown mode store the role the same way (`customData.role`) and are drawn in the
 * same colour: the active theme's `markdown` token for that role.
 */
import { describe, expect, it } from "vitest";

import { buildPageElements } from "../../../sdk/api/shared/pageItems";
import { buildRoleColor, roleTokenColor } from "../markdown/roleColors";
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
