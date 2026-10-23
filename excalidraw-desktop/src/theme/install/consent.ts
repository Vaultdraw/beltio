/** The network consent for theme downloads, shared by the install dialog and the theme browser. */

import { getPreferences, updatePreferences } from "../../vault/preferences";
import { flushSettings } from "../../vault/settingsSync";

export const hasThemeConsent = (win: Window = window): boolean => {
  const prefs = getPreferences(win);
  return prefs.networkEnabled && prefs.networkAllowThemes === true;
};

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
export const grantThemeConsent = async (
  win: Window = window,
): Promise<boolean> => {
  updatePreferences({ networkEnabled: true, networkAllowThemes: true }, win);
  try {
    await flushSettings();
  } catch {
    // Browser mode or a failed write: the next request reports the problem.
  }
  return hasThemeConsent(win);
};
