/**
 * `ctx.theme`: the colours the app shows, read only. Built on the first read
 * of `ctx.theme`; nothing listens until a plugin calls `onChange`.
 *
 * Values come from the computed style of the document, so they are what the
 * user sees, also for the stock theme (which writes no inline tokens). A token
 * the document does not define reads as "".
 */
import { TOKEN_NAMES } from "../../theme/types";
import {
  getAppearanceVersion,
  subscribeAppearance,
} from "../../vault/appearance";

import { guard } from "./guard";

import type { Disposable, ThemeApi, ThemeMode, ThemeTokenName } from "../api";

type Tokens = Readonly<Record<ThemeTokenName, string>>;

let cache: { doc: Document; version: number; tokens: Tokens } | null = null;

/** The frozen token table of `doc`, rebuilt only after the appearance changed. */
export function readTokens(doc: Document): Tokens {
  const version = getAppearanceVersion();
  if (cache && cache.doc === doc && cache.version === version) {
    return cache.tokens;
  }
  const style = doc.defaultView?.getComputedStyle(doc.documentElement);
  const table: Record<string, string> = {};
  for (const name of TOKEN_NAMES) {
    table[name] = style?.getPropertyValue(name).trim() ?? "";
  }
  const tokens = Object.freeze(table) as Tokens;
  cache = { doc, version, tokens };
  return tokens;
}

export const resetThemeCache = (): void => {
  cache = null;
};

export const currentMode = (doc: Document): ThemeMode =>
  doc.documentElement.classList.contains("dark") ? "dark" : "light";

export const currentThemeId = (doc: Document): string =>
  doc.documentElement.dataset.vaultTheme || "default";

export function createThemeApi(
  pluginId: string,
  doc: Document,
  track: (fn: () => void) => Disposable,
  isLive: () => boolean,
): ThemeApi {
  return {
    mode: () => currentMode(doc),
    tokens: () => readTokens(doc),
    onChange(cb) {
      const safe = guard(pluginId, cb, "theme.onChange");
      const off = subscribeAppearance(() => {
        if (isLive()) {
          safe({ mode: currentMode(doc), themeId: currentThemeId(doc) });
        }
      });
      return track(off);
    },
  };
}
