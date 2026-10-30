/**
 * When a download feature (theme install, theme browser, plugin browser) is blocked, and the one
 * click that unblocks it. Nothing is ever asked: the internet is on unless Offline mode is on or
 * the user turned that one download off.
 */

import {
  getPreferences,
  isOffline,
  updatePreferences,
} from "../../vault/preferences";
import { setWebFetchPolicy } from "../../network/webFetchPolicy";
import { flushSettings } from "../../vault/settingsSync";

/** The preference that holds a download switch (`network.allow_<purpose>`). */
export type ConsentField = "networkAllowThemes" | "networkAllowPlugins";

const WHAT: Record<ConsentField, { use: string; off: string }> = {
  networkAllowThemes: { use: "install themes", off: "Theme downloads" },
  networkAllowPlugins: {
    use: "browse plugins",
    off: "The community plugins list",
  },
};

/** Why `field`'s downloads are blocked, in plain words; null when they are allowed. */
export const blockReason = (
  field: ConsentField,
  win: Window = window,
): string | null => {
  const prefs = getPreferences(win);
  if (isOffline(prefs)) {
    return `Offline mode is on. Turn it off in Settings to ${WHAT[field].use}.`;
  }
  return prefs[field] === false
    ? `${WHAT[field].off} are turned off in Settings.`
    : null;
};

export const hasConsent = (field: ConsentField, win: Window = window) =>
  blockReason(field, win) === null;

export const hasThemeConsent = (win: Window = window): boolean =>
  hasConsent("networkAllowThemes", win);

/** The label of the button that lifts the block. */
export const unblockLabel = (win: Window = window): string =>
  isOffline(getPreferences(win)) ? "Turn off Offline mode" : "Turn on";

/**
 * Lifts the block (Offline mode off, or the one download back on) and waits until it is on disk
 * (the desktop backend re-reads config.toml). Returns whether the feature may go ahead.
 */
export const unblock = async (
  field: ConsentField,
  win: Window = window,
): Promise<boolean> => {
  updatePreferences(
    { networkOffline: false, networkEnabled: true, [field]: undefined },
    win,
  );
  try {
    await flushSettings();
  } catch {
    // Browser mode or a failed write: the next request reports the problem.
  }
  return hasConsent(field, win);
};

export const unblockThemes = (win: Window = window): Promise<boolean> =>
  unblock("networkAllowThemes", win);

// The webview download guard asks here (browser harness only; Rust has its own check).
setWebFetchPolicy(blockReason);
