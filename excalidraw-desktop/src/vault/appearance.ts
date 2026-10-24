/**
 * Applies the active colour theme to the document: `--vault-*` tokens and
 * Excalidraw UI variables (theme engine `applyThemeTokens`) plus the
 * `html.dark` class. Used before the first paint (main.tsx) and by
 * useAppearance whenever the theme, mode, OS appearance or theme files change.
 *
 * The stock Default theme applies nothing (VaultShell.css and Excalidraw's
 * own stylesheet render exactly the pre-theme look), except that an accent
 * colour applies the primary-related properties only.
 */

import {
  applyAccent,
  applyThemeTokens,
  deriveTokens,
  excalidrawVariableOverrides,
  normalizeAccent,
  pickOn,
} from "../theme";
import {
  isStockDefault,
  resolveSelectedTheme,
  type ThemeEntry,
  type ThemeRegistry,
} from "../theme/registry";

import { resolveTheme, type VaultPreferences } from "./preferences";

import type { AppliedTheme, ThemeMode, ThemeVariant } from "../theme";

export interface AppearanceSnapshot {
  /** Resolved mode (light/dark/system → actual). */
  mode: ThemeMode;
  entry: ThemeEntry;
  /** The entry's variant for `mode`, with the accent applied. */
  variant: ThemeVariant;
  /** Normalised accent ("#rrggbb"), "" when none/invalid. */
  accent: string;
  syncCanvas: boolean;
  /** Unknown/broken selected theme (Default is used instead). */
  problem: string | null;
  /** Stable identity of what is shown (theme content + mode + sync). */
  key: string;
}

export const computeAppearance = (
  prefs: Pick<VaultPreferences, "theme" | "colorTheme" | "syncCanvas"> &
    Partial<Pick<VaultPreferences, "accentColor">>,
  registry: ThemeRegistry,
  win: Window | null | undefined,
): AppearanceSnapshot => {
  const mode = resolveTheme(prefs.theme, win);
  const { entry, problem } = resolveSelectedTheme(registry, prefs.colorTheme);
  const accent = normalizeAccent(prefs.accentColor);
  const variant = applyAccent(entry.theme[mode], accent, mode);
  const syncCanvas = !!prefs.syncCanvas;
  const key = `${entry.source}:${entry.key}:${mode}:${
    syncCanvas ? 1 : 0
  }:${accent}:${JSON.stringify(variant)}`;
  return { mode, entry, variant, accent, syncCanvas, problem, key };
};

let applied: {
  doc: Document;
  key: string;
  handle: AppliedTheme | null;
} | null = null;

/** Custom properties derived from the primary colour. */
const PRIMARY_PROPERTY =
  /primary|brand|link-color|focus-highlight|select-highlight|logo-icon|color-selection|slider-track|icon-white/;

// --text-primary-color is the body text colour, not the accent.
const onlyPrimary = (vars: Record<string, string>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(vars).filter(
      ([name]) =>
        PRIMARY_PROPERTY.test(name) && name !== "--text-primary-color",
    ),
  );

/** Token key (theme content + mode); sync does not change the chrome. */
const tokenKey = (s: AppearanceSnapshot) =>
  isStockDefault(s.entry)
    ? `default:${s.mode}:${s.accent}`
    : `${s.entry.source}:${s.entry.key}:${s.mode}:${JSON.stringify(s.variant)}`;

/**
 * Writes the snapshot's tokens to `doc` (idempotent) and syncs `html.dark`.
 * Returns true when the tokens changed.
 */
export const applyAppearance = (
  doc: Document,
  snapshot: AppearanceSnapshot,
): boolean => {
  const root = doc.documentElement;
  root.classList.toggle("dark", snapshot.mode === "dark");
  root.dataset.vaultTheme = snapshot.entry.key;
  root.dataset.vaultCanvasSync = snapshot.syncCanvas ? "on" : "off";

  const key = tokenKey(snapshot);
  if (applied && applied.doc === doc && applied.key === key) {
    return false;
  }
  if (applied && applied.doc === doc) {
    applied.handle?.restore();
  }
  let handle: AppliedTheme | null = null;
  const stock = isStockDefault(snapshot.entry);
  if (!stock || snapshot.accent) {
    const tokens = deriveTokens(snapshot.variant, snapshot.mode);
    const all = {
      ...tokens,
      // Label on danger buttons (dark themes have light danger colours).
      "--vault-on-danger": pickOn(
        tokens["--vault-danger"],
        ["#ffffff", tokens["--vault-bg"], "#000000"],
        4.5,
      ),
    };
    const excalidraw = excalidrawVariableOverrides(tokens, snapshot.mode);
    handle = applyThemeTokens(
      doc,
      stock ? onlyPrimary(all) : all,
      stock ? onlyPrimary(excalidraw) : excalidraw,
    );
  }
  applied = { doc, key, handle };
  notifyAppearanceChanged();
  return true;
};

const appearanceListeners = new Set<() => void>();
let appearanceVersion = 0;

/** Rises with every applied change; readers cache against it instead of listening. */
export const getAppearanceVersion = (): number => appearanceVersion;

/**
 * Called after the applied tokens change (theme, mode or accent). Nothing is
 * stored or run until someone subscribes (the plugin theme API does).
 */
export const subscribeAppearance = (cb: () => void): (() => void) => {
  appearanceListeners.add(cb);
  return () => {
    appearanceListeners.delete(cb);
  };
};

/** Listeners now subscribed (the zero-cost test for plugins that never read the theme). */
export const appearanceListenerCount = (): number => appearanceListeners.size;

/** Tells the listeners the tokens changed; tests that fake a theme call it too. */
export const notifyAppearanceChanged = (): void => {
  appearanceVersion++;
  appearanceListeners.forEach((cb) => {
    try {
      cb();
    } catch (err) {
      console.error("appearance listener failed", err);
    }
  });
};

/** Removes everything applyAppearance added (tests). */
export const resetAppliedAppearance = () => {
  applied?.handle?.restore();
  applied = null;
};
