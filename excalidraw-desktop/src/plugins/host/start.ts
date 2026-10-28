/** Starts the plugin host after the first frame; nothing here runs on the startup path. */
import { subscribePreferences } from "../../vault/preferences";
import { enabledPluginIds } from "../enabledIds";
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
import { createAppDevLogSink } from "./devLog";
import { installImportRunner } from "./importers";
import { setDevLogSink } from "./errors";
import { ensureDevListener } from "./manage";
import { setPluginsList } from "./pluginsState";
import { noticePluginsWaitingForReview } from "./reviewNotice";
import { registerSafeModeCommands } from "./safeModeCommands";
import { registerStatusBarCommands } from "./statusBarCommands";

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
  // Cheap: lines are only buffered for plugins that are `dev` in the current list.
  const devLog = createAppDevLogSink(win);
  setDevLogSink(devLog);
  const offCommands = registerSafeModeCommands(list.safeMode !== null);
  const offStatusCommands = registerStatusBarCommands(win);
  const offImports = installImportRunner();
  const launchTimer = win.setTimeout(
    () => void backend.launchOk().catch(() => {}),
    LAUNCH_OK_DELAY_MS,
  );
  let startupDone = Promise.resolve();
  let last: string | null = null;
  const apply = () => {
    const enabled = enabledPluginIds(win);
    const key = JSON.stringify(enabled);
    if (key === last) {
      return;
    }
    last = key;
    startupDone = applyPlugins(win, schedule) ?? startupDone;
  };
  apply();
  if (list.safeMode === null) {
    noticePluginsWaitingForReview(list.plugins, enabledPluginIds(win));
  }
  ensureDevListener();
  const off = subscribePreferences(apply);
  performance.mark("vaultdraw:plugins:started");
  markPluginHostStarted();
  return {
    stop: () => {
      off();
      offCommands();
      offStatusCommands();
      offImports();
      devLog.flush();
      setDevLogSink(null);
      win.clearTimeout(launchTimer);
    },
    get startupDone() {
      return startupDone;
    },
  };
}
