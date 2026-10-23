/** Installed themes in the browser harness (the desktop app uses the themes folder). */

import type { ThemeListingEntry } from "../registry";
import type { ThemeSource } from "./types";

const KEY = "vaultdraw.installedThemes";

export interface StoredTheme {
  name: string;
  json: string;
  source: ThemeSource;
}

const storage = (win?: Window | null): Storage | null => {
  try {
    return (win ?? globalThis.window)?.localStorage ?? null;
  } catch {
    return null;
  }
};

export const readStoredThemes = (win?: Window | null): StoredTheme[] => {
  try {
    const parsed: unknown = JSON.parse(storage(win)?.getItem(KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter(
          (t): t is StoredTheme =>
            !!t && typeof t.name === "string" && typeof t.json === "string",
        )
      : [];
  } catch {
    return [];
  }
};

export const writeStoredThemes = (
  themes: StoredTheme[],
  win?: Window | null,
) => {
  try {
    storage(win)?.setItem(KEY, JSON.stringify(themes));
  } catch {
    // Storage blocked: the install is simply not remembered.
  }
};

/** The stored themes in the shape of a `list_themes` result. */
export const readBrowserInstalledThemes = (
  win?: Window | null,
): ThemeListingEntry[] =>
  readStoredThemes(win).map((t) => ({
    id: t.name,
    path: `${t.name}/${t.name}.json`,
    json: t.json,
    error: null,
  }));
