/**
 * Hang watchdog: the native side shows the Wait / Quit dialog and reads the
 * `[watchdog]` keys itself at hang time. This side only validates the keys,
 * flips the switch from the palette and reads the last-hang record on demand.
 */
import { toastStore } from "../toasts/toastStore";
import { loadTauriInvoke } from "../vault/DesktopVaultRepository";
import { getPreferences, updatePreferences } from "../vault/preferences";

export type HangChoice = "wait" | "quit" | "recovered";

/** What the Tauri command `watchdog_last_hang` returns (or null). */
export type LastHang = {
  atMs: number;
  secondsUnresponsive: number;
  choice: HangChoice;
};

const CHOICE_WORDS: Record<HangChoice, string> = {
  wait: "you chose Wait",
  quit: "you chose Quit",
  recovered: "the page recovered",
};

/** `watchdog.toggle`: flips watchdog.enabled and says so. */
export const toggleWatchdog = (win?: Window | null) => {
  const next = !getPreferences(win).watchdogEnabled;
  updatePreferences({ watchdogEnabled: next }, win);
  toastStore.push({ message: `Hang watchdog ${next ? "on" : "off"}` });
};

export const describeLastHang = (hang: LastHang | null): string => {
  if (!hang) {
    return "No hang recorded";
  }
  const when = new Date(hang.atMs).toLocaleString();
  const choice = CHOICE_WORDS[hang.choice] ?? hang.choice;
  return `Last hang: ${when}, ${Math.round(
    hang.secondsUnresponsive,
  )} s, ${choice}`;
};

/** `watchdog.showLastHang`: asks the native side; no Tauri or an error means none. */
export const showLastHang = async () => {
  let hang: LastHang | null = null;
  try {
    const invoke = await loadTauriInvoke();
    hang = invoke
      ? ((await invoke("watchdog_last_hang")) as LastHang | null)
      : null;
  } catch {
    hang = null;
  }
  toastStore.push({ message: describeLastHang(hang) });
};
