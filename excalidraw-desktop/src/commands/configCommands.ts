/**
 * Config commands: reload, open the files, reset the Settings changes. They work on
 * the files only, so they need no vault. Every one is rebindable and has no default
 * key. Resetting asks first (a shared confirmation, also used by Settings → General).
 */
import { toastStore } from "../toasts/toastStore";
import {
  getSettingsStatus,
  isConfigFolderActive,
  isWarning,
  openConfigDir,
  openConfigFile,
  reloadSettings,
  resetOverrides,
  revealOverrides,
} from "../vault/settingsSync";

import type { CommandDefinition, CommandHandlers } from "./types";

export const CONFIG_COMMAND_IDS = {
  reload: "config.reload",
  openFile: "config.openFile",
  openOverrides: "config.openOverrides",
  openFolder: "config.openFolder",
  resetOverrides: "config.resetOverrides",
} as const;

const I = CONFIG_COMMAND_IDS;

const command = (id: string, title: string): CommandDefinition => ({
  id,
  title,
  category: "Config",
  keys: { default: [] },
});

export const CONFIG_COMMANDS: CommandDefinition[] = [
  command(I.reload, "Config: Reload config files"),
  command(I.openFile, "Config: Open config.toml"),
  command(
    I.openOverrides,
    "Config: Show Settings changes file (overrides.toml)",
  ),
  command(I.openFolder, "Config: Open config folder"),
  command(I.resetOverrides, "Config: Reset all Settings changes"),
];

// ---------------------------------------------------------------------------
// The confirmation for "reset all Settings changes" (one dialog for the command and
// the Settings button; <ConfigResetConfirm> in the app shell renders it).
// ---------------------------------------------------------------------------

let resetPending = false;
const listeners = new Set<() => void>();
const setPending = (next: boolean) => {
  resetPending = next;
  listeners.forEach((l) => l());
};

export const subscribeResetRequest = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const getResetRequest = () => resetPending;

/** Ask to delete overrides.toml; nothing happens until the dialog is confirmed. */
export const requestResetOverrides = () => {
  if (!needsDesktop("Settings changes")) {
    return;
  }
  setPending(true);
};
export const cancelResetRequest = () => setPending(false);

/** The confirmed reset: deletes overrides.toml, config.toml stays as it is. */
export async function confirmResetOverrides(): Promise<void> {
  setPending(false);
  try {
    const existed = await resetOverrides();
    toastStore.push({
      message: existed
        ? "Settings changes reset. config.toml values and defaults apply."
        : "No Settings changes to reset.",
    });
  } catch (err) {
    fail("Could not reset Settings changes", err);
  }
}

// ---------------------------------------------------------------------------

const errorText = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

const fail = (what: string, err: unknown) =>
  toastStore.push({ message: `${what}: ${errorText(err)}`, kind: "error" });

const needsDesktop = (what: string) => {
  if (isConfigFolderActive()) {
    return true;
  }
  toastStore.push({
    message: `${what} is only available in the desktop app`,
    kind: "error",
  });
  return false;
};

async function reload() {
  if (!needsDesktop("Config files")) {
    return;
  }
  try {
    const changed = await reloadSettings();
    const problems = getSettingsStatus().problems;
    const errors = problems.filter((p) => !isWarning(p)).length;
    toastStore.push(
      errors
        ? {
            message: `Reloaded with ${errors} error${
              errors === 1 ? "" : "s"
            }: see Settings → General`,
            kind: "error",
          }
        : {
            message: changed
              ? "Reloaded the config files."
              : "The config files are up to date.",
          },
    );
  } catch (err) {
    fail("Could not reload", err);
  }
}

const open =
  (what: string, task: () => Promise<void>, label: string) => async () => {
    if (!needsDesktop(what)) {
      return;
    }
    try {
      await task();
    } catch (err) {
      fail(label, err);
    }
  };

export const CONFIG_COMMAND_HANDLERS: CommandHandlers = {
  [I.reload]: reload,
  [I.openFile]: open(
    "The config file",
    openConfigFile,
    "Could not open config.toml",
  ),
  [I.openOverrides]: open(
    "The Settings changes file",
    revealOverrides,
    "Could not show overrides.toml",
  ),
  [I.openFolder]: open(
    "The config folder",
    openConfigDir,
    "Could not open the config folder",
  ),
  [I.resetOverrides]: requestResetOverrides,
};
