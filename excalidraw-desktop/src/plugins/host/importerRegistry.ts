/**
 * The importers each plugin registered (`ctx.importers.register`) and the
 * import running now. Kept apart from importers.ts (the runner) so the plugin
 * context can use it without importing activation.
 */
import type { Importer } from "../api";
import type { PluginRuntime } from "./types";

const impls = new WeakMap<PluginRuntime, Map<string, Importer>>();

export const setImporter = (
  rt: PluginRuntime,
  id: string,
  importer: Importer,
): void => {
  let map = impls.get(rt);
  if (!map) {
    map = new Map();
    impls.set(rt, map);
  }
  map.set(id, importer);
};

/** Removes the importer only while it is still the registered one. */
export const removeImporter = (
  rt: PluginRuntime,
  id: string,
  importer: Importer,
): void => {
  const map = impls.get(rt);
  if (map?.get(id) === importer) {
    map.delete(id);
  }
};

export const getImporter = (
  rt: PluginRuntime,
  id: string,
): Importer | undefined => impls.get(rt)?.get(id);

export const clearImporters = (rt: PluginRuntime): void => {
  impls.delete(rt);
};

/** The import running now, if any (one at a time). */
let current: { pluginId: string; controller: AbortController } | null = null;

export const currentImport = () => current;

export const beginImport = (
  pluginId: string,
  controller: AbortController,
): void => {
  current = { pluginId, controller };
};

export const endImport = (controller: AbortController): void => {
  if (current?.controller === controller) {
    current = null;
  }
};

/** The plugin was stopped or disposed: its running import is aborted. */
export const abortPluginImport = (pluginId: string): void => {
  if (current?.pluginId === pluginId) {
    current.controller.abort("stop");
  }
};
