import { useSyncExternalStore } from "react";

import {
  getPreferences,
  subscribePreferences,
  type PreferencesSnapshot,
} from "../../vault/preferences";

/** One preference, re-rendering when it changes (for rows that skip SettingsContext). */
export const usePreference = <K extends keyof PreferencesSnapshot>(
  field: K,
  win: Window = window,
): PreferencesSnapshot[K] =>
  useSyncExternalStore(
    subscribePreferences,
    () => getPreferences(win)[field],
    () => getPreferences(win)[field],
  );
