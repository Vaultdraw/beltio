/** Offline mode: the one switch for every network feature (`network.offline`). */
import { toastStore } from "../toasts/toastStore";
import {
  getPreferences,
  isOffline,
  updatePreferences,
} from "../vault/preferences";

/**
 * Turns Offline mode on or off (`on` omitted: flips it). Turning it off also clears the old master
 * switch (`network.enabled = false`), which would otherwise keep the app offline.
 */
export function setOfflineMode(on?: boolean, win: Window = window): boolean {
  const next = on ?? !isOffline(getPreferences(win));
  updatePreferences({ networkOffline: next, networkEnabled: true }, win);
  toastStore.push({
    message: next
      ? "Offline mode is on. Nothing leaves this computer."
      : "Offline mode is off.",
    key: "offline-mode",
  });
  return next;
}
