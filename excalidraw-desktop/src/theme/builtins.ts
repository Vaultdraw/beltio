/**
 * Built-in themes: a few bundled, the rest loaded on demand.
 *
 * - builtin-index.json (generated, see builtinIndex.ts) lists every
 *   built-in with its name and preview colours: lists, pickers and the
 *   palette never touch a theme file.
 * - EAGER themes (Default and seven popular Noctalia palettes) are in the
 *   startup bundle. Every other file is its own lazy chunk, fetched by
 *   loadBuiltinTheme() when that theme is selected.
 * - A theme is parsed (parseThemeFile) once, on first use.
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

/** Bundled with the app (keep in sync with EAGER_THEME_IDS). */
const EAGER: Record<string, unknown> = import.meta.glob(
  [
    "./builtin/default.json",
    "./builtin/noctalia/{noctalia,catppuccin,dracula,gruvbox,nord,rose-pine,tokyo-night}.json",
  ],
  { eager: true, import: "default" },
);

/** One lazy chunk per file. */
const LAZY = import.meta.glob(
  [
    "./builtin/**/*.json",
    "!./builtin/default.json",
    "!./builtin/noctalia/{noctalia,catppuccin,dracula,gruvbox,nord,rose-pine,tokyo-night}.json",
  ],
  { import: "default" },
) as Record<string, () => Promise<unknown>>;

/** Ids of the bundled built-ins (tests / docs). */
export const EAGER_THEME_IDS = [
  "default",
  "noctalia",
  "catppuccin",
  "dracula",
  "gruvbox",
  "nord",
  "rose-pine",
  "tokyo-night",
] as const;

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

/** Loaded theme JSON by id (lazy ones once fetched). */
const jsonById = new Map<string, unknown>();
const loading = new Map<string, Promise<ResolvedTheme | null>>();
const resolvedCache = new Map<string, ResolvedTheme>();

const availableJson = (id: string): { json: unknown } | null => {
  if (jsonById.has(id)) {
    return { json: jsonById.get(id) };
  }
  const entry = indexEntry(id);
  return entry && entry.path in EAGER ? { json: EAGER[entry.path] } : null;
};

/** True when getBuiltinTheme(id) can answer synchronously. */
export const isBuiltinThemeLoaded = (id: string): boolean =>
  resolvedCache.has(id) || availableJson(id) !== null;

/**
 * Parses (once) and returns one built-in theme by id. Null when the id is
 * unknown or the theme is a lazy one not loaded yet (see loadBuiltinTheme).
 */
export const getBuiltinTheme = (id: string): ResolvedTheme | null => {
  const hit = resolvedCache.get(id);
  if (hit) {
    return hit;
  }
  const entry = indexEntry(id);
  const source = entry && availableJson(id);
  if (!entry || !source) {
    return null;
  }
  const theme = parseThemeFile(source.json, entry.name);
  resolvedCache.set(id, theme);
  return theme;
};

/** Loads (fetching its chunk if lazy) and parses one built-in; null when unknown. */
export const loadBuiltinTheme = (id: string): Promise<ResolvedTheme | null> => {
  if (isBuiltinThemeLoaded(id)) {
    return Promise.resolve(getBuiltinTheme(id));
  }
  const entry = indexEntry(id);
  const load = entry && LAZY[entry.path];
  if (!load) {
    return Promise.resolve(null);
  }
  let pending = loading.get(id);
  if (!pending) {
    pending = load()
      .then((json) => {
        jsonById.set(id, json);
        return getBuiltinTheme(id);
      })
      .finally(() => loading.delete(id));
    loading.set(id, pending);
  }
  return pending;
};

/** Number of built-ins parsed so far (tests / diagnostics). */
export const parsedBuiltinCount = () => resolvedCache.size;

/**
 * Loads and parses every built-in, Default first. Expensive (fetches 100+
 * chunks): tests and tools only; the app uses previews and loadBuiltinTheme.
 */
export const loadBuiltinThemes = async (): Promise<ResolvedTheme[]> =>
  (
    await Promise.all(builtinThemeFiles().map((f) => loadBuiltinTheme(f.id)))
  ).filter((t): t is ResolvedTheme => t !== null);

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

/** Clears every cache, including loaded lazy themes (tests / benchmarks). */
export const resetBuiltinCaches = () => {
  jsonById.clear();
  loading.clear();
  resolvedCache.clear();
  previewCache.clear();
};
