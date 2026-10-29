/** The plugin's settings (`[plugin.markdown-import]`), read live through ctx.settings. */
import type {
  FontFamilyName,
  PageSizeName,
  PluginContext,
} from "@vaultdraw/api";

export type ObsidianLinks = "drawing" | "text";

export type FontChoice =
  | "excalifont"
  | "nunito"
  | "comic-shanns"
  | "virgil"
  | "helvetica"
  | "cascadia";

/** The font choices that name a family: the `font` setting values and their families. */
export const FONT_CHOICES: Readonly<Record<FontChoice, FontFamilyName>> = {
  excalifont: "Excalifont",
  nunito: "Nunito",
  "comic-shanns": "Comic Shanns",
  virgil: "Virgil",
  helvetica: "Helvetica",
  cascadia: "Cascadia",
};

const FONT_VALUES = [
  "default",
  "document",
  ...(Object.keys(FONT_CHOICES) as FontChoice[]),
] as const;

export interface ImportSettings {
  /**
   * "default" follows the user's drawing font (`drawingFont`); "document" is the
   * Document font; any other value names a family.
   */
  font: typeof FONT_VALUES[number];
  /** The family a new drawing's text gets (Settings → Drawing → Font), read with the settings. */
  drawingFont?: FontFamilyName;
  fontSize: number;
  pageSize: PageSizeName;
  partElements: number;
  obsidianAttachments: boolean;
  obsidianLinks: ObsidianLinks;
  obsidianExcalidraw: boolean;
  /** Write `Import report` when something did not import cleanly (unset counts as off). */
  obsidianReport?: boolean;
  /**
   * Obsidian's "Strict line breaks": on, a single newline in a paragraph joins the lines with a
   * space; off (Obsidian's default), it stays a line break.
   */
  strictLineBreaks?: boolean;
}

/** The fallback drawing font (Excalifont); the Document font is the plain sans. */
export const DEFAULT_FONT: FontFamilyName = "Excalifont";
export const DOCUMENT_FONT: FontFamilyName = "Liberation Sans";

const PAGE_SIZES: readonly PageSizeName[] = [
  "a3",
  "a4",
  "a5",
  "b5",
  "letter",
  "legal",
];

const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T =>
  list.includes(v as T) ? (v as T) : d;

const int = (v: unknown, d: number, min: number, max: number): number =>
  typeof v === "number" && Number.isFinite(v)
    ? Math.min(max, Math.max(min, Math.round(v)))
    : d;

const bool = (v: unknown, d: boolean): boolean =>
  typeof v === "boolean" ? v : d;

/** The options every note is parsed with: soft line breaks stay line breaks unless strict. */
export const parseOptions = (
  s: Pick<ImportSettings, "strictLineBreaks">,
): { softBreakNewline: boolean } => ({ softBreakNewline: !s.strictLineBreaks });

/** The user's current drawing font; Excalifont when the host cannot say. */
const drawingFontOf = (ctx: PluginContext): FontFamilyName => {
  try {
    return ctx.scene.currentTextStyle().fontFamily;
  } catch {
    return DEFAULT_FONT;
  }
};

/** Read on every import, so a change in Settings applies to the next one (live reload). */
export function readSettings(ctx: PluginContext): ImportSettings {
  const get = (key: string): unknown => ctx.settings.get(key);
  return {
    font: oneOf(get("font"), FONT_VALUES, "default"),
    drawingFont: drawingFontOf(ctx),
    fontSize: int(get("font_size"), 16, 8, 72),
    pageSize: oneOf(get("page_size"), PAGE_SIZES, "a4"),
    partElements: int(get("part_elements"), 1000, 200, 20000),
    obsidianAttachments: bool(get("obsidian_attachments"), true),
    obsidianLinks: oneOf(get("obsidian_links"), ["drawing", "text"], "drawing"),
    obsidianExcalidraw: bool(get("obsidian_excalidraw"), true),
    obsidianReport: bool(get("obsidian_report"), true),
    strictLineBreaks: bool(get("strict_line_breaks"), false),
  };
}

/** The code font: code blocks, math and text tables. */
export const CODE_FONT: FontFamilyName = "Cascadia";

/**
 * Every family a note is laid out in. All of them must be loaded before the
 * width table is measured: a family still loading measures in a fallback
 * font, and its lines then overflow (and clip) once the real font draws.
 */
export const layoutFamiliesOf = (
  s: Pick<ImportSettings, "font" | "drawingFont">,
): FontFamilyName[] => [...new Set([fontFamilyOf(s), CODE_FONT])];

export const fontFamilyOf = (
  s: Pick<ImportSettings, "font" | "drawingFont">,
): FontFamilyName =>
  s.font === "document"
    ? DOCUMENT_FONT
    : s.font === "default"
    ? s.drawingFont ?? DEFAULT_FONT
    : FONT_CHOICES[s.font];
