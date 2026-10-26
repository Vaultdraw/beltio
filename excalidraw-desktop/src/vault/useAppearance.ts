/**
 * React side of colour themes: tracks preferences, OS appearance and the
 * theme registry, applies tokens + `html.dark`, and drives canvas sync.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { setCanvasSync, setCanvasThemeSource } from "../editor/canvasSync";
import {
  getThemeRegistry,
  isThemeReady,
  loadThemeEntry,
  resolveSelectedTheme,
  THEMES_CHANGED_EVENT,
  watchThemeRegistry,
  type ThemeRegistry,
} from "../theme/registry";

import { applyAppearance, computeAppearance } from "./appearance";
import { getPreferences, type VaultPreferences } from "./preferences";
import { PREFERENCES_CHANGED_EVENT } from "./settingsSync";

import type { AppearanceSnapshot } from "./appearance";

export interface AppearanceState {
  snapshot: AppearanceSnapshot;
  registry: ThemeRegistry;
  /** Re-read preferences after a local change (Settings, editor menu). */
  refresh: () => void;
}

/** What the open vault overrides (`<vault>/.excalidraw-vault/settings.toml`). */
export type VaultAppearance = Partial<
  Pick<VaultPreferences, "colorTheme" | "theme" | "accentColor">
>;

const NO_VAULT_APPEARANCE: VaultAppearance = {};

export const useAppearance = (
  doc: Document | null,
  win: Window | null,
  vaultAppearance: VaultAppearance = NO_VAULT_APPEARANCE,
): AppearanceState => {
  const {
    colorTheme: vaultTheme,
    theme: vaultMode,
    accentColor: vaultAccent,
  } = vaultAppearance;
  const [registry, setRegistry] = useState<ThemeRegistry>(getThemeRegistry);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!win) {
      return;
    }
    const onThemes = () => setRegistry(getThemeRegistry());
    const media = win.matchMedia?.("(prefers-color-scheme: dark)");
    win.addEventListener(PREFERENCES_CHANGED_EVENT, refresh);
    win.addEventListener(THEMES_CHANGED_EVENT, onThemes);
    try {
      media?.addEventListener("change", refresh);
    } catch {
      media?.addListener(refresh);
    }
    const stopWatching = watchThemeRegistry(win);
    // The registry may have been loaded (main.tsx) before this mounted.
    onThemes();
    return () => {
      win.removeEventListener(PREFERENCES_CHANGED_EVENT, refresh);
      win.removeEventListener(THEMES_CHANGED_EVENT, onThemes);
      try {
        media?.removeEventListener("change", refresh);
      } catch {
        media?.removeListener(refresh);
      }
      stopWatching();
    };
  }, [win, refresh]);

  const shown = useRef<AppearanceSnapshot | null>(null);
  const snapshot = useMemo(() => {
    const global = getPreferences(win);
    const prefs = {
      ...global,
      colorTheme: vaultTheme ?? global.colorTheme,
      theme: vaultMode ?? global.theme,
      accentColor: vaultAccent ?? global.accentColor,
    };
    // A lazy built-in still loading: keep the current look (no flash of
    // Default); THEMES_CHANGED_EVENT brings a new registry when it lands.
    const { entry } = resolveSelectedTheme(registry, prefs.colorTheme);
    if (!isThemeReady(entry)) {
      void loadThemeEntry(entry);
      if (shown.current) {
        return shown.current;
      }
    }
    return computeAppearance(prefs, registry, win);
    // `tick` re-reads preferences after local edits and OS changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registry, tick, win, vaultTheme, vaultMode, vaultAccent]);
  shown.current = snapshot;

  // Layout effect: tokens land before the browser paints the new state.
  useLayoutEffect(() => {
    if (doc) {
      applyAppearance(doc, snapshot);
    }
    // The canvas palette follows the theme, not the accent.
    const source = {
      variant: snapshot.entry.theme[snapshot.mode],
      mode: snapshot.mode,
      key: snapshot.key,
    };
    // Page mode's "match current theme" paper needs it even with sync off.
    setCanvasThemeSource(source);
    setCanvasSync(snapshot.syncCanvas ? source : null);
  }, [doc, snapshot]);

  return { snapshot, registry, refresh };
};
