/** Applies the current plugin list and enabled ids to the registries (stubs). */
import { scheduleIdle } from "../../platform/idle";

import { isBisectOff } from "../../extensionSwitches/bisectState";

import { enabledPluginIds } from "../enabledIds";
import { OFFICIAL_PLUGINS } from "../officialPlugins";
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

/**
 * An official plugin with a `startWhen` switch (auto-export) loads only while that switch is true in
 * config.toml; boot activates it when the switch turns on later.
 */
export function startsAtLaunch(id: string, win: Window): boolean {
  const key = OFFICIAL_PLUGINS.find((p) => p.id === id)?.startWhen;
  return !key || getPreferences(win).pluginSettings[id]?.[key] === true;
}

/**
 * Plugin safe mode turns off the plugins the user added; the bundled official plugins (graph,
 * gallery, frames, Markdown import, ...) are part of the app and stay on, as Obsidian's restricted
 * mode keeps its core plugins. Safe start (scope `core`) and a safe mode caused by crashed launches
 * register nothing. Otherwise stubs follow the list and the enabled ids.
 */
export function applyPlugins(
  win: Window,
  schedule: Schedule,
): Promise<void> | null {
  const { plugins, safeMode } = currentList();
  if (
    safeMode &&
    (safeMode.scope === "core" || safeMode.reason === "crashes")
  ) {
    return null;
  }
  // An extension bisect turns some plugins off for this launch.
  const bundled = new Set(
    plugins.filter((p) => p.source === "bundled").map((p) => p.id),
  );
  const enabled = enabledPluginIds(win).filter(
    (id) => !isBisectOff(id) && (!safeMode || bundled.has(id)),
  );
  const { started } = syncPlugins(plugins, enabled);
  return queueStartupActivations(
    plugins,
    started.filter((id) => startsAtLaunch(id, win)),
    schedule,
  );
}
