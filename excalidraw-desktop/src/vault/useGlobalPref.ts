/**
 * One global (not per-vault) preference as React state, live from config.toml
 * and Settings, with its setter. Renders read a snapshot cached per
 * preferences change (no storage read per render).
 */
import { useCallback, useSyncExternalStore } from "react";

import {
  getPreferences,
  subscribePreferences,
  updatePreferences,
  type PreferencesSnapshot,
  type VaultPreferences,
} from "./preferences";

let version = 0;
subscribePreferences(() => {
  version++;
});

let cached: {
  version: number;
  win: Window | null | undefined;
  prefs: PreferencesSnapshot;
} | null = null;

/** getPreferences, re-read only after a preferences change (or another window). */
export const cachedPreferences = (win?: Window | null): PreferencesSnapshot => {
  if (!cached || cached.version !== version || cached.win !== win) {
    cached = { version, win, prefs: getPreferences(win) };
  }
  return cached.prefs;
};

export function useGlobalPref<F extends keyof PreferencesSnapshot>(
  win: Window | null | undefined,
  field: F,
): [PreferencesSnapshot[F], (value: PreferencesSnapshot[F]) => void] {
  const value = useSyncExternalStore(
    subscribePreferences,
    () => cachedPreferences(win)[field],
  );
  const set = useCallback(
    (next: PreferencesSnapshot[F]) =>
      void updatePreferences(
        { [field]: next } as Partial<VaultPreferences>,
        win,
      ),
    [win, field],
  );
  return [value, set];
}
