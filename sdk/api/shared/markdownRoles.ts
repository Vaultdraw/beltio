/**
 * Markdown roles: what a piece of an imported note is (a level-2 heading, a
 * link, a code box), so the theme decides its colour, the way Obsidian themes
 * set `--h1-color`, `--link-color` or `--code-background`.
 *
 * A role is stored twice on an element: in `customData` (`role: "h2"`), and
 * as a reserved file colour from `ROLE_COLORS`. The canvas colour map
 * (excalidraw-desktop/src/theme/canvas.ts) draws each reserved colour in the
 * active theme's `markdown` colour for that role, so switching themes restyles
 * every import with no rewrite. A colour the user picks is no reserved colour,
 * so it is kept as is: picking a colour drops the role.
 *
 * The reserved colours are what the page shows on plain white paper and in
 * exports: near-black text (as Obsidian's default theme draws headings), a
 * blue link, a grey code box and a violet quote bar. They sit one step away
 * from the editor's own picker colours so a user's colour is never taken for
 * a role.
 */

export const MARKDOWN_ROLES = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "bold",
  "italic",
  "link",
  "code",
  "code_bg",
  "quote_bar",
] as const;

export type MarkdownRole = typeof MARKDOWN_ROLES[number];

/** The reserved file colour of each role (lowercase `#rrggbb`, all distinct). */
export const ROLE_COLORS: Readonly<Record<MarkdownRole, string>> = {
  h1: "#1e1e1f",
  h2: "#1e1e20",
  h3: "#1e1e21",
  h4: "#1e1e22",
  h5: "#1e1e23",
  h6: "#1e1e24",
  bold: "#1e1e25",
  italic: "#1e1e26",
  link: "#1971c3",
  code: "#1e1e27",
  code_bg: "#e9ecee",
  quote_bar: "#9775fb",
};

/** The heading role of a level (1 to 6). */
export const headingRoleOf = (level: number): MarkdownRole =>
  `h${Math.min(6, Math.max(1, Math.round(level)))}` as MarkdownRole;

/** The role a reserved colour stands for, if it is one. */
export const roleOfColor = (color: unknown): MarkdownRole | null => {
  if (typeof color !== "string") {
    return null;
  }
  const c = color.toLowerCase();
  for (const role of MARKDOWN_ROLES) {
    if (ROLE_COLORS[role] === c) {
      return role;
    }
  }
  return null;
};
