/**
 * Theme registry: the built-in themes plus the user's theme files from
 * `<config dir>/themes/` (Tauri `list_themes`).
 *
 * Rules (personal/planning/themes.md, "Final decisions"):
 * - A theme is selected by its file/folder name (built-ins: their name),
 *   case-insensitively; its id/slug and JSON `name` also match.
 * - A user theme overrides a built-in with the same name.
 * - `themes/X.json` and `themes/X/X.json` both present: the folder wins and
 *   a warning is reported.
 * - An unknown or broken selected theme falls back to Default with a problem.
 *
 * In a plain browser (Playwright harness, tests) only built-ins exist.
 *
 * Built-ins are lazy: names and previews come from the generated index, and
 * most theme files are separate chunks (builtins.ts). Lists use
 * `listThemeSummaries()` (cheap previews). Before showing a theme, load it
 * with `loadThemeEntry()` / `loadSelectedTheme()`; `entry.theme` on a lazy
 * built-in that isn't loaded yet returns Default and starts the load, and
 * THEMES_CHANGED_EVENT fires (with a new registry object) once it lands.
 */

import { touchesConfigSubdir } from "../vault/configPaths";
import { isTauriAvailable } from "../vault/DesktopVaultRepository";
import { getSettingsStatus } from "../vault/settingsSync";

import { parseThemeFile, slugify } from "./normalize";
import { readBrowserInstalledThemes } from "./install/browserStore";
import { removedThemeName } from "./removedThemes";

import {
  BUILTIN_ALIASES,
  builtinThemeFiles,
  builtinThemePreview,
  DEFAULT_THEME_ID,
  getBuiltinTheme,
  isBuiltinThemeLoaded,
  loadBuiltinTheme,
  previewFromTheme,
} from "./builtins";

import type { BuiltinOrigin, BuiltinThemeFile, ThemePreview } from "./builtins";
import type { ResolvedTheme } from "./types";

/** One row of the Rust `list_themes` result. */
export interface ThemeListingEntry {
  id: string;
  path: string;
  json: string | null;
  error: string | null;
}

export interface ThemeEntry {
  /** Value stored in `appearance.theme`: built-in name or user file id. */
  key: string;
  /** Slug of the theme name (cheap; same as `theme.id`). */
  id: string;
  /** Display name (cheap; same as `theme.name`). */
  name: string;
  author?: string;
  /**
   * The fully resolved theme. For built-ins this is a lazy getter: the file
   * is parsed on first access; a lazy built-in not loaded yet returns
   * Default and starts loading (see isThemeReady / loadThemeEntry). Avoid
   * touching it for every entry in a list; use `summary` instead.
   */
  readonly theme: ResolvedTheme;
  /** Cheap card data (previews etc.). */
  readonly summary: ThemeSummary;
  source: "builtin" | "user";
  /** Which bundled set a built-in comes from (null for user themes). */
  origin: BuiltinOrigin | null;
  /** Theme file on disk (user themes only). */
  path: string | null;
  /** Problems worth showing (user themes only; built-in notes are hidden). */
  warnings: string[];
  /** True when this user theme replaces a built-in of the same name. */
  overridesBuiltin: boolean;
}

/** Everything a theme card / list row needs, without resolving the theme. */
export interface ThemeSummary {
  /** Value to store in `appearance.theme` (pass to resolveTheme / findTheme). */
  key: string;
  id: string;
  name: string;
  author?: string;
  source: "builtin" | "user";
  origin: BuiltinOrigin | null;
  /** Theme file on disk (user themes only). */
  path: string | null;
  overridesBuiltin: boolean;
  /** User-theme problems worth showing (empty for built-ins). */
  warnings: string[];
  /** dark/light preview colours + which modes are generated. */
  preview: ThemePreview;
}

export interface ThemeFileProblem {
  id: string;
  path: string;
  kind: "error" | "warning";
  message: string;
}

export interface ThemeRegistry {
  mode: "tauri" | "browser";
  themes: ThemeEntry[];
  /** Files that could not be loaded, and folder/file clashes. */
  fileProblems: ThemeFileProblem[];
  /** list_themes itself failed (folder unreadable…). */
  loadError: string | null;
}

export interface ResolvedSelection {
  entry: ThemeEntry;
  /** Set when the selected theme is unknown or broken and Default is used. */
  problem: string | null;
  /**
   * Repo name of a theme that used to be bundled (not in the app any more,
   * not in themes/): Default is used, `problem` stays null, and the UI
   * offers "Install it".
   */
  removed: string | null;
}

const lower = (s: string) => s.trim().toLowerCase();

const summaryOf = (
  entry: Omit<ThemeEntry, "theme" | "summary">,
  preview: ThemePreview,
): ThemeSummary => ({
  key: entry.key,
  id: entry.id,
  name: entry.name,
  ...(entry.author ? { author: entry.author } : {}),
  source: entry.source,
  origin: entry.origin,
  path: entry.path,
  overridesBuiltin: entry.overridesBuiltin,
  warnings: entry.warnings,
  preview,
});

/** A built-in entry whose theme and preview are computed on first access. */
const builtinEntry = (file: BuiltinThemeFile): ThemeEntry => {
  const base: Omit<ThemeEntry, "theme" | "summary"> = {
    key: file.name,
    id: file.id,
    name: file.name,
    ...(file.author ? { author: file.author } : {}),
    source: "builtin" as const,
    origin: file.origin,
    path: null,
    warnings: [],
    overridesBuiltin: false,
  };
  let summary: ThemeSummary | null = null;
  const entry: ThemeEntry = {
    ...base,
    get theme() {
      const theme = getBuiltinTheme(file.id);
      if (theme) {
        return theme;
      }
      void loadThemeEntry(entry);
      return getBuiltinTheme(DEFAULT_THEME_ID) as ResolvedTheme;
    },
    get summary() {
      return (summary ??= summaryOf(
        base,
        builtinThemePreview(file.id) as ThemePreview,
      ));
    },
  };
  return entry;
};

const userEntry = (
  theme: ResolvedTheme,
  key: string,
  path: string,
  overridesBuiltin: boolean,
): ThemeEntry => {
  const base = {
    key,
    id: theme.id,
    name: theme.name,
    ...(theme.author ? { author: theme.author } : {}),
    source: "user" as const,
    origin: null,
    path,
    warnings: theme.warnings,
    overridesBuiltin,
  };
  return { ...base, theme, summary: summaryOf(base, previewFromTheme(theme)) };
};

const builtinEntries = (): ThemeEntry[] =>
  builtinThemeFiles().map(builtinEntry);

const sameName = (entry: ThemeEntry, id: string) => {
  const q = lower(id);
  return (
    lower(entry.key) === q ||
    lower(entry.name) === q ||
    entry.id === slugify(id)
  );
};

const segments = (path: string) => path.split(/[\\/]+/).filter(Boolean).length;

/** Registry with the built-in themes only. */
export const builtinRegistry = (
  mode: ThemeRegistry["mode"] = "browser",
): ThemeRegistry => ({
  mode,
  themes: builtinEntries(),
  fileProblems: [],
  loadError: null,
});

const errorText = (err: unknown) =>
  err instanceof Error
    ? err.message
    : err && typeof err === "object" && "message" in err
    ? String((err as { message: unknown }).message)
    : String(err);

/** Builds the registry from a `list_themes` result (pure; unit tested). */
export const buildThemeRegistry = (
  listing: readonly ThemeListingEntry[],
  mode: ThemeRegistry["mode"] = "tauri",
): ThemeRegistry => {
  const fileProblems: ThemeFileProblem[] = [];

  // 1. Group by id (case-insensitive); the folder layout (deeper path) wins.
  const byId = new Map<string, ThemeListingEntry[]>();
  for (const item of listing) {
    if (!item || typeof item.id !== "string" || !item.id.trim()) {
      continue;
    }
    const key = lower(item.id);
    byId.set(key, [...(byId.get(key) ?? []), item]);
  }
  const chosen: ThemeListingEntry[] = [];
  for (const items of byId.values()) {
    const sorted = [...items].sort(
      (a, b) => segments(b.path) - segments(a.path),
    );
    const [winner, ...losers] = sorted;
    chosen.push(winner);
    for (const loser of losers) {
      fileProblems.push({
        id: winner.id,
        path: loser.path,
        kind: "warning",
        message: `Both themes/${loser.id}.json and the folder themes/${winner.id}/ exist; using the folder`,
      });
    }
  }

  // 2. Parse.
  const userEntries: ThemeEntry[] = [];
  for (const item of chosen) {
    if (item.error || item.json == null) {
      fileProblems.push({
        id: item.id,
        path: item.path,
        kind: "error",
        message: item.error ?? `${item.id}: the theme file could not be read`,
      });
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(item.json);
    } catch (err) {
      fileProblems.push({
        id: item.id,
        path: item.path,
        kind: "error",
        message: `Theme "${item.id}": not valid JSON (${errorText(err)})`,
      });
      continue;
    }
    try {
      userEntries.push(
        userEntry(parseThemeFile(json, item.id), item.id, item.path, false),
      );
    } catch (err) {
      fileProblems.push({
        id: item.id,
        path: item.path,
        kind: "error",
        message: errorText(err),
      });
    }
  }

  // 3. Merge: user themes replace built-ins in place, others are appended
  //    (sorted by name).
  const themes = builtinEntries();
  const extra: ThemeEntry[] = [];
  for (const entry of userEntries) {
    const index = themes.findIndex(
      (b) => b.source === "builtin" && sameName(b, entry.key),
    );
    if (index >= 0) {
      themes[index] = userEntry(
        entry.theme,
        entry.key,
        entry.path as string,
        true,
      );
    } else {
      extra.push(entry);
    }
  }
  extra.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, {
      sensitivity: "base",
    }),
  );
  return { mode, themes: [...themes, ...extra], fileProblems, loadError: null };
};

/** Finds a theme by key, name or slug (case-insensitive). */
export const findTheme = (
  registry: ThemeRegistry,
  name: string,
): ThemeEntry | null => {
  const q = lower(name);
  if (!q) {
    return null;
  }
  return (
    registry.themes.find((e) => lower(e.key) === q) ??
    registry.themes.find((e) => lower(e.name) === q) ??
    registry.themes.find((e) => e.id === slugify(name)) ??
    registry.themes.find((e) => e.id === BUILTIN_ALIASES[slugify(name)]) ??
    null
  );
};

export const getDefaultEntry = (registry: ThemeRegistry): ThemeEntry =>
  registry.themes.find(
    (e) => e.source === "builtin" && e.id === DEFAULT_THEME_ID,
  ) ??
  findTheme(registry, "Default") ??
  builtinEntries()[0];

/** True when the entry is the stock Default look (no tokens applied). */
export const isStockDefault = (entry: ThemeEntry) =>
  entry.source === "builtin" && entry.id === DEFAULT_THEME_ID;

/** The theme to use for a selected name, falling back to Default. */
export const resolveSelectedTheme = (
  registry: ThemeRegistry,
  selected: string,
): ResolvedSelection => {
  const found = findTheme(registry, selected);
  if (found) {
    return { entry: found, problem: null, removed: null };
  }
  const fallback = getDefaultEntry(registry);
  const removed = removedThemeName(selected);
  if (removed) {
    return { entry: fallback, problem: null, removed };
  }
  const broken = registry.fileProblems.find(
    (p) => p.kind === "error" && lower(p.id) === lower(selected),
  );
  return {
    entry: fallback,
    problem: broken
      ? `Theme "${selected}" could not be loaded: ${broken.message}. Using ${fallback.name}.`
      : `Theme "${selected}" was not found in the themes folder. Using ${fallback.name}.`,
    removed: null,
  };
};

/**
 * Cheap list of every theme for pickers: names + preview colours. Built-ins
 * are not parsed (their previews come straight from the JSON).
 */
export const listThemeSummaries = (
  registry: ThemeRegistry = getThemeRegistry(),
): ThemeSummary[] => registry.themes.map((e) => e.summary);

/**
 * Fully resolves one theme by key, name or slug (loading and parsing a
 * built-in on first use). Null when unknown; use resolveSelectedTheme for
 * the Default fallback.
 */
export const resolveTheme = async (
  key: string,
  registry: ThemeRegistry = getThemeRegistry(),
): Promise<ResolvedTheme | null> => {
  const entry = findTheme(registry, key);
  if (!entry) {
    return null;
  }
  await loadThemeEntry(entry);
  return entry.theme;
};

// ---------------------------------------------------------------------------
// Lazy built-ins
// ---------------------------------------------------------------------------

/** True when `entry.theme` is the real theme (not the loading fallback). */
export const isThemeReady = (entry: ThemeEntry): boolean =>
  entry.source !== "builtin" || isBuiltinThemeLoaded(entry.id);

const pendingLoads = new Map<string, Promise<void>>();

/** Lets React state holding the registry see that a theme finished loading. */
const announceLoaded = () => {
  if (cached) {
    cached = { ...cached };
  }
  const win = typeof window !== "undefined" ? window : null;
  if (win && typeof win.dispatchEvent === "function") {
    win.dispatchEvent(
      new CustomEvent(THEMES_CHANGED_EVENT, { detail: getThemeRegistry() }),
    );
  }
};

/**
 * Loads a lazy built-in's chunk (no-op when ready). Fires
 * THEMES_CHANGED_EVENT once when a load completes. Never throws.
 */
export const loadThemeEntry = (entry: ThemeEntry): Promise<void> => {
  if (isThemeReady(entry)) {
    return Promise.resolve();
  }
  let pending = pendingLoads.get(entry.id);
  if (!pending) {
    pending = loadBuiltinTheme(entry.id)
      .then(announceLoaded, () => {
        // Chunk failed to load: entry.theme keeps returning Default.
      })
      .finally(() => pendingLoads.delete(entry.id));
    pendingLoads.set(entry.id, pending);
  }
  return pending;
};

/** Loads the theme `selected` resolves to (startup: before the first paint). */
export const loadSelectedTheme = (
  registry: ThemeRegistry,
  selected: string,
): Promise<void> =>
  loadThemeEntry(resolveSelectedTheme(registry, selected).entry);

// ---------------------------------------------------------------------------
// Runtime (Tauri): load, cache and live reload
// ---------------------------------------------------------------------------

export type ThemeInvokeFn = <T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
) => Promise<T>;

export type ThemeListenFn = <T = unknown>(
  event: string,
  handler: (event: { payload: T }) => void,
) => Promise<() => void>;

export interface ThemeRegistryDeps {
  invoke?: ThemeInvokeFn;
  listen?: ThemeListenFn;
  /** Force Tauri mode (tests). Defaults to isTauriAvailable(win). */
  tauri?: boolean;
}

/** Fired on window when the registry was reloaded. detail = registry. */
export const THEMES_CHANGED_EVENT = "vault-themes-changed";

let cached: ThemeRegistry | null = null;

export const getThemeRegistry = (): ThemeRegistry =>
  cached ?? builtinRegistry();

/** Replaces the cached registry (tests, reloads). */
export const setThemeRegistry = (registry: ThemeRegistry | null) => {
  cached = registry;
};

const getInvoke = async (deps: ThemeRegistryDeps): Promise<ThemeInvokeFn> =>
  deps.invoke ??
  ((await import("@tauri-apps/api/core")).invoke as ThemeInvokeFn);

/**
 * Loads built-ins + user themes and caches the result. Never throws: a
 * failing `list_themes` keeps the built-ins and reports `loadError`.
 */
export const loadThemeRegistry = async (
  win: Window | null | undefined,
  deps: ThemeRegistryDeps = {},
): Promise<ThemeRegistry> => {
  const useTauri = deps.tauri ?? isTauriAvailable(win);
  if (!useTauri) {
    // Browser harness: themes installed from a URL live in localStorage.
    const stored = readBrowserInstalledThemes(win);
    cached = stored.length
      ? buildThemeRegistry(stored, "browser")
      : builtinRegistry("browser");
    return cached;
  }
  try {
    const invoke = await getInvoke(deps);
    const listing = await invoke<ThemeListingEntry[]>("list_themes");
    cached = buildThemeRegistry(Array.isArray(listing) ? listing : [], "tauri");
  } catch (err) {
    cached = {
      ...builtinRegistry("tauri"),
      loadError: `Could not read the themes folder: ${errorText(err)}`,
    };
  }
  return cached;
};

/**
 * Loads the registry again and tells the app (THEMES_CHANGED_EVENT), e.g.
 * after a theme was installed or removed. Returns the new registry.
 */
export const reloadThemeRegistry = async (
  win: Window,
  deps: ThemeRegistryDeps = {},
): Promise<ThemeRegistry> => {
  const registry = await loadThemeRegistry(win, deps);
  const EventCtor =
    (win as Window & { CustomEvent?: typeof CustomEvent }).CustomEvent ??
    CustomEvent;
  win.dispatchEvent(new EventCtor(THEMES_CHANGED_EVENT, { detail: registry }));
  return registry;
};

const touchesThemes = (paths: unknown) =>
  touchesConfigSubdir(paths, "themes", getSettingsStatus().configDir);

/**
 * Reloads the registry whenever the config watcher reports a change inside
 * themes/, then dispatches THEMES_CHANGED_EVENT on `win`. Returns a disposer.
 * No-op outside Tauri.
 */
export const watchThemeRegistry = (
  win: Window,
  deps: ThemeRegistryDeps = {},
): (() => void) => {
  const useTauri = deps.tauri ?? isTauriAvailable(win);
  if (!useTauri) {
    return () => {};
  }
  let disposed = false;
  let unlisten: (() => void) | null = null;
  let reloading: Promise<unknown> = Promise.resolve();
  const reload = () => {
    reloading = reloading.then(async () => {
      if (disposed) {
        return;
      }
      const registry = await loadThemeRegistry(win, deps);
      if (!disposed) {
        const EventCtor =
          (win as Window & { CustomEvent?: typeof CustomEvent }).CustomEvent ??
          CustomEvent;
        win.dispatchEvent(
          new EventCtor(THEMES_CHANGED_EVENT, { detail: registry }),
        );
      }
    });
  };
  void (async () => {
    try {
      const listen =
        deps.listen ??
        ((await import("@tauri-apps/api/event"))
          .listen as unknown as ThemeListenFn);
      const off = await listen<{ paths?: string[] }>("config-change", (e) => {
        if (touchesThemes(e?.payload?.paths)) {
          reload();
        }
      });
      if (disposed) {
        off();
      } else {
        unlisten = off;
      }
    } catch {
      // No live reload; reopening Settings or restarting picks changes up.
    }
  })();
  return () => {
    disposed = true;
    unlisten?.();
  };
};

/** Reveal `<config dir>/themes/` in the file manager (Tauri only). */
export const openThemesDir = async (deps: ThemeRegistryDeps = {}) => {
  const invoke = await getInvoke(deps);
  await invoke("open_themes_dir");
};
