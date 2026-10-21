/**
 * Runtime registry of declared plugin settings (plugin id -> declarations).
 * Schemas arrive when a plugin activates, long after config.toml was parsed.
 */
import { isPluginId, isPluginKey } from "../../vault/pluginSettingsTable";

import { declProblem, type SettingDecl } from "./declaredSettings";

const NONE: readonly SettingDecl[] = Object.freeze([]);

const decls = new Map<string, readonly SettingDecl[]>();
const listeners = new Set<() => void>();
let version = 0;

const bump = () => {
  version++;
  for (const cb of [...listeners]) {
    cb();
  }
};

/** Register `list` for `pluginId`; the returned function removes it again. */
export function registerPluginSettings(
  pluginId: string,
  list: readonly SettingDecl[],
): () => void {
  if (!isPluginId(pluginId)) {
    throw new Error(`Invalid plugin id "${pluginId}"`);
  }
  const keys = new Set<string>();
  for (const decl of list) {
    const problem = declProblem(decl);
    if (!isPluginKey(decl.key) || keys.has(decl.key) || problem) {
      throw new Error(
        `Invalid setting "${decl.key}" of ${pluginId}: ${
          problem ?? "bad or duplicate key"
        }`,
      );
    }
    keys.add(decl.key);
  }
  const mine = Object.freeze([...list]);
  decls.set(pluginId, mine);
  bump();
  return () => {
    if (decls.get(pluginId) === mine) {
      decls.delete(pluginId);
      bump();
    }
  };
}

/** Stable until the plugin's registration changes (useSyncExternalStore). */
export const pluginSettingsDecls = (pluginId: string): readonly SettingDecl[] =>
  decls.get(pluginId) ?? NONE;

export const pluginSettingDecl = (pluginId: string, key: string) =>
  pluginSettingsDecls(pluginId).find((d) => d.key === key);

export const registeredSettingsPlugins = (): string[] => [...decls.keys()];

export const getPluginSettingsVersion = () => version;

export function subscribePluginSettings(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
