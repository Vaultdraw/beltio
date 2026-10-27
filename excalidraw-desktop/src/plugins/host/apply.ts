/** Applies the current plugin list and enabled ids to the registries (stubs). */
import { scheduleIdle } from "../../platform/idle";

import { isBisectOff } from "../../extensionSwitches/bisectState";

import { enabledPluginIds } from "../enabledIds";

import { ensureActive } from "./activation";
import { currentList } from "./pluginsState";

import { syncPlugins } from "./index";

import type { PluginInfo } from "./types";

export type Schedule = (run: () => void) => void;

/** requestIdleCallback is missing in WebKit: fall back to a short timeout. */
export const idleSchedule =
  (win: Window): Schedule =>
  (run) => {
    scheduleIdle(win, run);
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

/** Safe mode registers nothing; otherwise stubs follow the list and the enabled ids. */
export function applyPlugins(
  win: Window,
  schedule: Schedule,
): Promise<void> | null {
  const { plugins, safeMode } = currentList();
  if (safeMode) {
    return null;
  }
  // An extension bisect turns some plugins off for this launch.
  const enabled = enabledPluginIds(win).filter((id) => !isBisectOff(id));
  const { started } = syncPlugins(plugins, enabled);
  return queueStartupActivations(plugins, started, schedule);
}
