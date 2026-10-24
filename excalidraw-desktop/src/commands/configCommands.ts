/**
 * Config commands: reload, open the files, reset the Settings changes. They work on
 * the files only, so they need no vault. Every one is rebindable and has no default
 * key. Resetting asks first (a shared confirmation, also used by Settings → General).
 */
import { toastStore } from "../toasts/toastStore";
import { checkConfig, doctorReport } from "../vault/configReport";
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
  check: "config.check",
  debugInfo: "config.debugInfo",
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
  command(I.check, "Config: Check config files"),
  command(I.debugInfo, "Config: Show debug info"),
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
// The report dialog (config check, debug info): a tiny store; <ReportDialogHost>
// in the app shell renders it, loaded on first use.
// ---------------------------------------------------------------------------

export type ReportTone = "ok" | "warning" | "error";
export interface ReportRequest {
  title: string;
  text: string;
  tone: ReportTone;
}

let report: ReportRequest | null = null;
const reportListeners = new Set<() => void>();
const setReport = (next: ReportRequest | null) => {
  report = next;
  reportListeners.forEach((l) => l());
};

export const subscribeReport = (listener: () => void) => {
  reportListeners.add(listener);
  return () => reportListeners.delete(listener);
};
export const getReport = () => report;
export const openReport = (next: ReportRequest) => setReport(next);
export const closeReport = () => setReport(null);

/** Check the config files and show the report (command and Settings button). */
export async function runConfigCheck(): Promise<void> {
  if (!needsDesktop("Config check")) {
    return;
  }
  try {
    const result = await checkConfig();
    openReport({
      title: "Config check",
      text: result.text,
      tone:
        result.errors > 0 ? "error" : result.warnings > 0 ? "warning" : "ok",
    });
  } catch (err) {
    fail("Could not check the config files", err);
  }
}

async function showDebugInfo(): Promise<void> {
  if (!needsDesktop("Debug info")) {
    return;
  }
  try {
    const result = await doctorReport();
    openReport({ title: "Debug info", text: result.text, tone: "ok" });
  } catch (err) {
    fail("Could not collect debug info", err);
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
  [I.check]: runConfigCheck,
  [I.debugInfo]: showDebugInfo,
};
