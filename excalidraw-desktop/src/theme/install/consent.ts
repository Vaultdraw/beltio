/** The network consent for downloads, shared by the theme install dialog, the theme browser and the plugins browser. */

import { getPreferences, updatePreferences } from "../../vault/preferences";
import { flushSettings } from "../../vault/settingsSync";

/** The preference that holds the per-purpose consent (`network.allow_<purpose>`). */
export type ConsentField = "networkAllowThemes" | "networkAllowPlugins";

export const hasConsent = (
  field: ConsentField,
  win: Window = window,
): boolean => {
  const prefs = getPreferences(win);
  return prefs.networkEnabled && prefs[field] === true;
};

export const hasThemeConsent = (win: Window = window): boolean =>
  hasConsent("networkAllowThemes", win);

export const consentText = (enabled: boolean, allow: boolean | undefined) =>
  !enabled
    ? "Network access is switched off in your settings (network.enabled). Turn it on and allow theme downloads?"
    : allow === false
    ? "Theme downloads are switched off (network.allow_themes). Allow them?"
    : "Vaultdraw will connect to GitHub, or to the address you give, to download a theme. It sends nothing but the request. You can change this any time in Settings, General.";

/**
 * Saves a yes and waits until it is on disk (the desktop backend re-reads config.toml). The app
 * asks once more in a native dialog; if that is declined the switches fall back and this returns
 * false.
 */
export const grantConsent = async (
  field: ConsentField,
  win: Window = window,
): Promise<boolean> => {
  updatePreferences({ networkEnabled: true, [field]: true }, win);
  try {
    await flushSettings();
  } catch {
    // Browser mode or a failed write: the next request reports the problem.
  }
  return hasConsent(field, win);
};

export const grantThemeConsent = (win: Window = window): Promise<boolean> =>
  grantConsent("networkAllowThemes", win);
