/** Starts the plugin host after the first frame; nothing here runs on the startup path. */
import { getPreferences, subscribePreferences } from "../../vault/preferences";
import { markPluginHostStarted } from "../hostFlag";
import { exposeSharedModules } from "../shared/exposeShared";

import { setActivationWindow } from "./activation";
import {
  applyPlugins,
  idleSchedule,
  queueStartupActivations,
  type Schedule,
} from "./apply";
import { getPluginsBackend } from "./backend";
import { ensureDevListener } from "./manage";
import { setPluginsList } from "./pluginsState";
import { registerSafeModeCommands } from "./safeModeCommands";

export { idleSchedule, queueStartupActivations };

/** The Rust side clears its crash counter once the host has run this long. */
export const LAUNCH_OK_DELAY_MS = 10_000;

export interface PluginHost {
  stop(): void;
  /** Resolves when every queued startup activation has finished. */
  startupDone: Promise<void>;
}

export async function startPluginHost(
  win: Window,
  schedule: Schedule = idleSchedule(win),
): Promise<PluginHost> {
  setActivationWindow(win);
  exposeSharedModules(win);
  const backend = getPluginsBackend();
  const list = await backend.list();
  setPluginsList(list);
  const offCommands = registerSafeModeCommands(list.safeMode !== null);
  const launchTimer = win.setTimeout(
    () => void backend.launchOk().catch(() => {}),
    LAUNCH_OK_DELAY_MS,
  );
  let startupDone = Promise.resolve();
  let last: string | null = null;
  const apply = () => {
    const enabled = getPreferences(win).pluginsEnabled;
    const key = JSON.stringify(enabled);
    if (key === last) {
      return;
    }
    last = key;
    startupDone = applyPlugins(win, schedule) ?? startupDone;
  };
  apply();
  ensureDevListener();
  const off = subscribePreferences(apply);
  performance.mark("vaultdraw:plugins:started");
  markPluginHostStarted();
  return {
    stop: () => {
      off();
      offCommands();
      win.clearTimeout(launchTimer);
    },
    get startupDone() {
      return startupDone;
    },
  };
}
