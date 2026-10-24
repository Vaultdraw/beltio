import { activityBarRegistry } from "../../activityBar/activityBarRegistry";
import { getRegisteredHandler } from "../../commands/handlerRegistry";
import { registeredCommands } from "../../commands/registry";
import { sceneListenerCount } from "../../sceneOps/sceneBus";
import { updatePreferences } from "../../vault/preferences";
import { registeredSettingsPlugins } from "../settings/registry";

import { resetActivation, setActivationWindow } from "./activation";
import { setPluginsBackend } from "./backend";
import { resetCosts } from "./cost";
import { resetErrors } from "./errors";
import {
  createFakeBackend,
  makePluginInfo,
  type FakeBackend,
} from "./fakeBackend";
import { resetLoader, setModuleLoader } from "./loader";
import { clearPluginStores } from "./storage";
import { pluginTimerCount } from "./context";

import type { Plugin } from "../api";
import type { PluginInfo } from "./types";

export interface Harness {
  backend: FakeBackend;
  loads: string[];
}

/** Fake backend + a module loader serving `modules` by plugin id. */
export function setupHost(
  infos: PluginInfo[],
  modules: Record<string, Plugin | (() => Plugin) | Error>,
): Harness {
  resetActivation();
  resetCosts();
  resetErrors();
  resetLoader();
  clearPluginStores();
  setActivationWindow(window);
  const backend = createFakeBackend(infos);
  setPluginsBackend(backend);
  const loads: string[] = [];
  setModuleLoader(async (url) => {
    const id = /plugin\/([a-z0-9-]+)\//.exec(url)![1];
    loads.push(id);
    const m = modules[id];
    if (m instanceof Error) {
      throw m;
    }
    return { default: typeof m === "function" ? m() : m };
  });
  updatePreferences({ pluginsEnabled: [] });
  return { backend, loads };
}

export const enable = (ids: string[]) =>
  updatePreferences({ pluginsEnabled: ids });

/** Sizes of every registry a plugin writes to. */
export const registrySizes = (probeId = "") => ({
  commands: registeredCommands().length,
  top: activityBarRegistry.list("activityBar.top").length,
  bottom: activityBarRegistry.list("activityBar.bottom").length,
  settings: registeredSettingsPlugins().length,
  timers: pluginTimerCount(),
  sceneListeners: sceneListenerCount(),
  handler: probeId ? !!getRegisteredHandler(probeId) : false,
});

export const withCommands = (id: string, ...shorts: string[]) =>
  makePluginInfo(id, {
    contributes: {
      commands: shorts.map((s) => ({
        id: s,
        title: `${id} ${s}`,
        keys: [],
        when: [],
        palette: true,
      })),
      panels: [],
      settings: [],
    },
  });

export const tick = () => new Promise((r) => setTimeout(r, 0));
