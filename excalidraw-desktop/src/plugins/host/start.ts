/** Starts the plugin host after the first frame; nothing here runs on the startup path. */
import { getPreferences, subscribePreferences } from "../../vault/preferences";
import { exposeSharedModules } from "../shared/exposeShared";

import { ensureActive, setActivationWindow } from "./activation";
import { getPluginsBackend } from "./backend";

import { syncPlugins } from "./index";

import type { PluginInfo } from "./types";

type Schedule = (run: () => void) => void;

/** requestIdleCallback is missing in WebKit: fall back to a short timeout. */
export const idleSchedule =
  (win: Window): Schedule =>
  (run) => {
    if (typeof win.requestIdleCallback === "function") {
      win.requestIdleCallback(() => run());
    } else {
      win.setTimeout(run, 50);
    }
  };

const queue: string[] = [];
let draining = false;

/** onStartupFinished plugins activate one at a time, each on its own idle tick. */
export function queueStartupActivations(
  infos: readonly PluginInfo[],
  ids: readonly string[],
  schedule: Schedule,
): Promise<void> {
  const byId = new Map(infos.map((i) => [i.id, i]));
  queue.push(
    ...ids.filter((id) =>
      byId.get(id)?.activation.includes("onStartupFinished"),
    ),
  );
  if (draining) {
    return Promise.resolve();
  }
  draining = true;
  return new Promise((resolve) => {
    const next = () => {
      const id = queue.shift();
      if (id === undefined) {
        draining = false;
        resolve();
        return;
      }
      schedule(() => void ensureActive(id).then(next));
    };
    next();
  });
}

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
  const { plugins } = await getPluginsBackend().list();
  let startupDone = Promise.resolve();
  let last: string | null = null;
  const apply = () => {
    const enabled = getPreferences(win).pluginsEnabled;
    const key = JSON.stringify(enabled);
    if (key === last) {
      return;
    }
    last = key;
    const { started } = syncPlugins(plugins, enabled);
    startupDone = queueStartupActivations(plugins, started, schedule);
  };
  apply();
  const off = subscribePreferences(apply);
  return {
    stop: off,
    get startupDone() {
      return startupDone;
    },
  };
}
