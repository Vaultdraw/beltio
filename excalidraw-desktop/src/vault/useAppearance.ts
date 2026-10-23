/**
 * React side of colour themes: tracks preferences, OS appearance and the
 * theme registry, applies tokens + `html.dark`, and drives canvas sync.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";

import { setCanvasSync, setCanvasThemeSource } from "../editor/canvasSync";
import {
  getThemeRegistry,
  THEMES_CHANGED_EVENT,
  watchThemeRegistry,
  type ThemeRegistry,
} from "../theme/registry";

import { applyAppearance, computeAppearance } from "./appearance";
import { getPreferences } from "./preferences";
import { PREFERENCES_CHANGED_EVENT } from "./settingsSync";

import type { AppearanceSnapshot } from "./appearance";

export interface AppearanceState {
  snapshot: AppearanceSnapshot;
  registry: ThemeRegistry;
  /** Re-read preferences after a local change (Settings, editor menu). */
  refresh: () => void;
}

export const useAppearance = (
  doc: Document | null,
  win: Window | null,
): AppearanceState => {
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

  const snapshot = useMemo(
    () => computeAppearance(getPreferences(win), registry, win),
    // `tick` re-reads preferences after local edits and OS changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [registry, tick, win],
  );

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
