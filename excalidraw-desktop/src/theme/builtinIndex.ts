/**
 * Builds builtin-index.json: one row per built-in theme with its name,
 * source and precomputed preview colours, so the app lists every built-in
 * without bundling or parsing the theme files.
 *
 * Not imported by the app. src/tests/themeBuiltins.test.ts checks the
 * committed index against the theme files and rewrites it with
 * `UPDATE_THEME_INDEX=1`.
 *
 * Sources, highest priority first when two files share a slug:
 *   1. builtin/noctalia/   Noctalia's own palettes (MIT, see NOTICE)
 *   2. builtin/community/  Noctalia community palettes (see SOURCE.md)
 *   3. builtin/*.json      Vaultdraw's own (Default)
 * Order: Default first, then by name.
 */

import { parseThemeFile, slugify } from "./normalize";
import { packPreviewColors, previewFromTheme } from "./preview";

import type { ThemeMode } from "./types";

export const DEFAULT_THEME_ID = "default";

export type BuiltinOrigin = "noctalia" | "community" | "vaultdraw";

/**
 * One built-in theme in builtin-index.json (kept small: it is in the
 * startup bundle). The id is slugify(name); the file is `<id>.json` in its
 * origin's folder unless `file` says otherwise; `author` is omitted when it
 * is the origin's usual author (`authors`).
 */
export interface BuiltinIndexEntry {
  name: string;
  origin: BuiltinOrigin;
  author?: string;
  /** File stem when it differs from the id. */
  file?: string;
  /** Packed preview colours (see packPreviewColors). */
  dark: string;
  light: string;
  /** The mode the file doesn't provide (generated from the other). */
  generated?: ThemeMode;
}

export interface BuiltinIndex {
  /** Most common author per origin. */
  authors: Partial<Record<BuiltinOrigin, string>>;
  themes: BuiltinIndexEntry[];
}

/** Folder of each origin, relative to theme/. */
export const ORIGIN_DIR: Record<BuiltinOrigin, string> = {
  noctalia: "./builtin/noctalia/",
  community: "./builtin/community/",
  vaultdraw: "./builtin/",
};

const ORIGIN_PRIORITY: Record<BuiltinOrigin, number> = {
  noctalia: 0,
  community: 1,
  vaultdraw: 2,
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const fileStem = (path: string) =>
  path.replace(/^.*\//, "").replace(/\.json$/i, "");

/** The index from the theme files of each origin ({ path: json }). */
export const buildBuiltinIndex = (
  sources: Record<BuiltinOrigin, Record<string, unknown>>,
): BuiltinIndex => {
  const byId = new Map<
    string,
    {
      id: string;
      name: string;
      author?: string;
      origin: BuiltinOrigin;
      path: string;
      json: unknown;
    }
  >();
  for (const origin of Object.keys(ORIGIN_PRIORITY) as BuiltinOrigin[]) {
    for (const [path, json] of Object.entries(sources[origin] ?? {})) {
      const raw = isPlainObject(json) ? json : {};
      const name =
        typeof raw.name === "string" && raw.name.trim()
          ? raw.name.trim()
          : fileStem(path);
      const id = slugify(name);
      const prev = byId.get(id);
      if (prev && ORIGIN_PRIORITY[prev.origin] <= ORIGIN_PRIORITY[origin]) {
        continue;
      }
      byId.set(id, {
        id,
        name,
        ...(typeof raw.author === "string" && raw.author.trim()
          ? { author: raw.author.trim() }
          : {}),
        origin,
        path,
        json,
      });
    }
  }
  const files = [...byId.values()];
  const authors: BuiltinIndex["authors"] = {};
  for (const origin of Object.keys(ORIGIN_PRIORITY) as BuiltinOrigin[]) {
    const counts = new Map<string, number>();
    for (const f of files) {
      if (f.origin === origin && f.author) {
        counts.set(f.author, (counts.get(f.author) ?? 0) + 1);
      }
    }
    const top = [...counts].sort((a, b) => b[1] - a[1])[0];
    if (top) {
      authors[origin] = top[0];
    }
  }
  const themes = files
    .sort((a, b) =>
      a.id === DEFAULT_THEME_ID
        ? -1
        : b.id === DEFAULT_THEME_ID
        ? 1
        : a.name.localeCompare(b.name, "en", { sensitivity: "base" }),
    )
    .map(({ id, name, author, origin, path, json }): BuiltinIndexEntry => {
      const preview = previewFromTheme(parseThemeFile(json, name));
      const generated = preview.generated.dark
        ? "dark"
        : preview.generated.light
        ? "light"
        : undefined;
      const stem = fileStem(path);
      return {
        name,
        origin,
        ...(author && author !== authors[origin] ? { author } : {}),
        ...(stem !== id ? { file: stem } : {}),
        dark: packPreviewColors(preview.dark),
        light: packPreviewColors(preview.light),
        ...(generated ? { generated } : {}),
      };
    });
  return { authors, themes };
};
