/** The plugin's settings (`[plugin.markdown-import]`), read live through ctx.settings. */
import type {
  FontFamilyName,
  PageSizeName,
  PluginContext,
} from "@vaultdraw/api";

export type ObsidianLinks = "drawing" | "text";

export interface ImportSettings {
  /** "document" switches to the Document font. */
  font: "default" | "document";
  fontSize: number;
  pageSize: PageSizeName;
  partElements: number;
  obsidianAttachments: boolean;
  obsidianLinks: ObsidianLinks;
  obsidianExcalidraw: boolean;
  /** Write `Import report` when something did not import cleanly (unset counts as off). */
  obsidianReport?: boolean;
}

/** The user's default drawing font is Excalifont; the Document font is the plain sans. */
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

/** Read on every import, so a change in Settings applies to the next one (live reload). */
export function readSettings(ctx: PluginContext): ImportSettings {
  const get = (key: string): unknown => ctx.settings.get(key);
  return {
    font: oneOf(get("font"), ["default", "document"], "default"),
    fontSize: int(get("font_size"), 16, 8, 72),
    pageSize: oneOf(get("page_size"), PAGE_SIZES, "a4"),
    partElements: int(get("part_elements"), 1000, 200, 20000),
    obsidianAttachments: bool(get("obsidian_attachments"), true),
    obsidianLinks: oneOf(get("obsidian_links"), ["drawing", "text"], "drawing"),
    obsidianExcalidraw: bool(get("obsidian_excalidraw"), true),
    obsidianReport: bool(get("obsidian_report"), true),
  };
}

export const fontFamilyOf = (s: Pick<ImportSettings, "font">): FontFamilyName =>
  s.font === "document" ? DOCUMENT_FONT : DEFAULT_FONT;
