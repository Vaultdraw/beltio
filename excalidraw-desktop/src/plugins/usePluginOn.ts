/** Whether an official plugin is on right now (its switch and `plugins.disabled` both allow it). */
import { useSyncExternalStore } from "react";

import { subscribePreferences } from "../vault/preferences";

import { enabledPluginIds } from "./enabledIds";

export function usePluginOn(id: string): boolean {
  return useSyncExternalStore(
    subscribePreferences,
    () => enabledPluginIds().includes(id),
    () => true,
  );
}
