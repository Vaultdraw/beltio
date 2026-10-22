/** Imports a plugin's main module once and caches it (re-enable reuses it). */
import { getPluginsBackend } from "./backend";
import { recordLoad } from "./cost";

import type { Plugin } from "../api";

import type { PluginInfo } from "./types";

export type ModuleLoader = (url: string) => Promise<unknown>;

const defaultLoader: ModuleLoader = (url) => import(/* @vite-ignore */ url);
let loadModule: ModuleLoader = defaultLoader;
const cache = new Map<string, Promise<Plugin>>();
/** Reload count per plugin: the `?t=` that busts the module cache. */
const generations = new Map<string, number>();

/** Tests and the e2e harness inject their own module source. */
export const setModuleLoader = (fn: ModuleLoader | null): void => {
  loadModule = fn ?? defaultLoader;
};

async function load(info: PluginInfo, suffix: string): Promise<Plugin> {
  const start = performance.now();
  const url = getPluginsBackend().moduleUrl(info.id, info.main) + suffix;
  const mod = (await loadModule(url)) as { default?: Plugin } | null;
  const plugin = mod?.default;
  if (!plugin || typeof plugin.activate !== "function") {
    throw new Error("main module must default-export a plugin with activate()");
  }
  recordLoad(info.id, performance.now() - start, start);
  return plugin;
}

export function loadPluginModule(info: PluginInfo): Promise<Plugin> {
  let p = cache.get(info.id);
  if (!p) {
    const gen = generations.get(info.id);
    p = load(info, gen ? `?t=${gen}` : "");
    cache.set(info.id, p);
    // A failed import is not cached as success; activation fails for the session.
  }
  return p;
}

/** Dev reload: drop the cache so the next load re-imports with a fresh `?t=`. */
export const forgetPluginModule = (id: string): void => {
  cache.delete(id);
  generations.set(id, (generations.get(id) ?? 0) + 1);
};

export const resetLoader = (): void => {
  cache.clear();
  generations.clear();
  loadModule = defaultLoader;
};
