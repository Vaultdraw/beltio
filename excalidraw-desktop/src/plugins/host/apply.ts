/** Applies the current plugin list and enabled ids to the registries (stubs). */
import { getPreferences } from "../../vault/preferences";

import { ensureActive } from "./activation";
import { currentList } from "./pluginsState";

import { syncPlugins } from "./index";

import type { PluginInfo } from "./types";

export type Schedule = (run: () => void) => void;

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

/** Safe mode registers nothing; otherwise stubs follow the list and the enabled ids. */
export function applyPlugins(
  win: Window,
  schedule: Schedule,
): Promise<void> | null {
  const { plugins, safeMode } = currentList();
  if (safeMode) {
    return null;
  }
  const { started } = syncPlugins(plugins, getPreferences(win).pluginsEnabled);
  return queueStartupActivations(plugins, started, schedule);
}
