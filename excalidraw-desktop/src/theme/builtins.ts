/**
 * Built-in themes: the ten most popular palettes, all in the startup bundle.
 * Every other theme lives in https://github.com/Vaultdraw/themes and is
 * installed on demand (see themeInstall/).
 *
 * - builtin-index.json (generated, see builtinIndex.ts) lists every
 *   built-in with its name and preview colours: lists, pickers and the
 *   palette never parse a theme file.
 * - A theme is parsed (parseThemeFile) once, on first use.
 * - loadBuiltinTheme() stays async so callers did not change when the other
 *   115 themes moved out of the app (themes-lazy, themes-10).
 */

import INDEX from "./builtin-index.json";
import { ORIGIN_DIR } from "./builtinIndex";
import { parseThemeFile, slugify } from "./normalize";
import { unpackPreviewColors } from "./preview";

import type {
  BuiltinIndex,
  BuiltinIndexEntry,
  BuiltinOrigin,
} from "./builtinIndex";
import type { ThemePreview } from "./preview";
import type { ResolvedTheme } from "./types";

export { DEFAULT_THEME_ID } from "./builtinIndex";
export type { BuiltinOrigin } from "./builtinIndex";
export { previewFromTheme, previewFromVariant } from "./preview";
export type { ThemePreview, ThemePreviewColors } from "./preview";

/** Every bundled theme file (ten). */
const BUNDLED: Record<string, unknown> = import.meta.glob(
  ["./builtin/default.json", "./builtin/*/*.json"],
  { eager: true, import: "default" },
);

/** Ids of the bundled built-ins, in picker order after Default (tests / docs). */
export const EAGER_THEME_IDS = [
  "default",
  "catppuccin",
  "dracula",
  "everforest",
  "gruvbox",
  "kanagawa",
  "nord",
  "one-dark",
  "solarized",
  "tokyo-night",
] as const;

/**
 * Names that used to select a bundled theme and now map to another one:
 * "One" became "One Dark", the old "Everforest Alt" palette is "Everforest".
 */
export const BUILTIN_ALIASES: Readonly<Record<string, string>> = {
  one: "one-dark",
  "everforest-alt": "everforest",
};

export interface BuiltinThemeFile {
  id: string;
  name: string;
  author?: string;
  origin: BuiltinOrigin;
  /** Bundle path, e.g. "./builtin/noctalia/nord.json". */
  path: string;
}

type IndexRow = BuiltinIndexEntry & BuiltinThemeFile;

let rows: IndexRow[] | null = null;
let byId: Map<string, IndexRow> | null = null;

const indexRows = (): IndexRow[] => {
  if (!rows) {
    const { authors, themes } = INDEX as BuiltinIndex;
    rows = themes.map((e) => {
      const id = slugify(e.name);
      const author = e.author ?? authors[e.origin];
      return {
        ...e,
        id,
        ...(author ? { author } : {}),
        path: `${ORIGIN_DIR[e.origin]}${e.file ?? id}.json`,
      };
    });
  }
  return rows;
};

const indexEntry = (id: string) =>
  (byId ??= new Map(indexRows().map((e) => [e.id, e]))).get(id);

let files: BuiltinThemeFile[] | null = null;

/** Every built-in, de-duplicated by slug, Default first then by name. No loading. */
export const builtinThemeFiles = (): readonly BuiltinThemeFile[] =>
  (files ??= indexRows().map(({ id, name, author, origin, path }) => ({
    id,
    name,
    ...(author ? { author } : {}),
    origin,
    path,
  })));

const resolvedCache = new Map<string, ResolvedTheme>();

/** True when getBuiltinTheme(id) can answer (every bundled id). */
export const isBuiltinThemeLoaded = (id: string): boolean =>
  resolvedCache.has(id) || indexEntry(id) !== undefined;

/** Parses (once) and returns one built-in theme by id; null when unknown. */
export const getBuiltinTheme = (id: string): ResolvedTheme | null => {
  const hit = resolvedCache.get(id);
  if (hit) {
    return hit;
  }
  const entry = indexEntry(id);
  if (!entry || !(entry.path in BUNDLED)) {
    return null;
  }
  const theme = parseThemeFile(BUNDLED[entry.path], entry.name);
  resolvedCache.set(id, theme);
  return theme;
};

/** Async for API stability; the theme is already in the bundle. */
export const loadBuiltinTheme = (id: string): Promise<ResolvedTheme | null> =>
  Promise.resolve(getBuiltinTheme(id));

/** Number of built-ins parsed so far (tests / diagnostics). */
export const parsedBuiltinCount = () => resolvedCache.size;

/** Parses every built-in, Default first (tests and tools). */
export const loadBuiltinThemes = async (): Promise<ResolvedTheme[]> =>
  builtinThemeFiles()
    .map((f) => getBuiltinTheme(f.id))
    .filter((t): t is ResolvedTheme => t !== null);

const previewCache = new Map<string, ThemePreview>();

/** Preview of a built-in from the index (no loading, no parsing). */
export const builtinThemePreview = (id: string): ThemePreview | null => {
  const hit = previewCache.get(id);
  if (hit) {
    return hit;
  }
  const entry = indexEntry(id);
  if (!entry) {
    return null;
  }
  const preview: ThemePreview = {
    dark: unpackPreviewColors(entry.dark),
    light: unpackPreviewColors(entry.light),
    generated: {
      dark: entry.generated === "dark",
      light: entry.generated === "light",
    },
  };
  previewCache.set(id, preview);
  return preview;
};

/** Clears every cache (tests / benchmarks). */
export const resetBuiltinCaches = () => {
  resolvedCache.clear();
  previewCache.clear();
};
