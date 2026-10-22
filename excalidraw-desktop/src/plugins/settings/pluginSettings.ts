/**
 * Read and write plugin settings on top of the preferences store (global
 * layer) and the per-vault store. P2's `settings.get/set/onChange` wrap this.
 */
import { getPreferences, updatePreferences } from "../../vault/preferences";
import {
  withPluginValue,
  type PluginSettingValue,
} from "../../vault/pluginSettingsTable";
import {
  getVaultSettingsSnapshot,
  setPluginOverride,
} from "../../vault/vaultSettings";

import {
  allowsScope,
  effectiveSetting,
  validateSettingValue,
  type SettingDecl,
  type SettingScopeName,
} from "./declaredSettings";
import {
  pluginSettingDecl,
  pluginSettingsDecls,
  registeredSettingsPlugins,
} from "./registry";

import type { SettingsProblem } from "../../vault/settingsSync";

export const effectiveDeclValue = (
  pluginId: string,
  decl: SettingDecl,
  win?: Window | null,
): PluginSettingValue =>
  effectiveSetting(
    decl,
    getPreferences(win).pluginSettings[pluginId]?.[decl.key],
    getVaultSettingsSnapshot().pluginOverrides[pluginId]?.[decl.key],
  );

/** Effective value (vault, global, default); raw layering without a decl. */
export function getPluginSetting(
  pluginId: string,
  key: string,
  win?: Window | null,
): PluginSettingValue | undefined {
  const decl = pluginSettingDecl(pluginId, key);
  if (decl) {
    return effectiveDeclValue(pluginId, decl, win);
  }
  return (
    getVaultSettingsSnapshot().pluginOverrides[pluginId]?.[key] ??
    getPreferences(win).pluginSettings[pluginId]?.[key]
  );
}

/**
 * Set (or with undefined remove) a value in one layer. Refused (false) for a
 * value the declaration rejects, a layer it does not allow, or "vault" without
 * a writable vault.
 */
export async function setPluginSetting(
  pluginId: string,
  key: string,
  value: PluginSettingValue | undefined,
  scope: SettingScopeName,
  win?: Window | null,
): Promise<boolean> {
  const decl = pluginSettingDecl(pluginId, key);
  if (
    decl &&
    (!allowsScope(decl, scope) ||
      (value !== undefined && !validateSettingValue(decl, value).ok))
  ) {
    return false;
  }
  if (scope === "vault") {
    return setPluginOverride(pluginId, key, value);
  }
  updatePreferences(
    {
      pluginSettings: withPluginValue(
        getPreferences(win).pluginSettings,
        pluginId,
        key,
        value,
      ),
    },
    win,
  );
  return true;
}

/** Stored values that fail their declaration (out of range or wrong type = the default). */
export function pluginSettingProblems(
  pluginId: string,
  decls: readonly SettingDecl[],
  win?: Window | null,
): SettingsProblem[] {
  const layers = [
    ["config.toml", getPreferences(win).pluginSettings[pluginId]],
    ["settings.toml", getVaultSettingsSnapshot().pluginOverrides[pluginId]],
  ] as const;
  return layers.flatMap(([file, values]) =>
    decls.flatMap((decl) => {
      const raw = values?.[decl.key];
      const result = raw === undefined ? null : validateSettingValue(decl, raw);
      return result && !result.ok
        ? [
            {
              kind: "invalid" as const,
              key: `plugin.${pluginId}.${decl.key}`,
              message: `${file}: plugin.${pluginId}.${result.problem}; using the default`,
            },
          ]
        : [];
    }),
  );
}

/** Problems of every plugin with declared settings. */
export const allPluginSettingProblems = (
  win?: Window | null,
): SettingsProblem[] =>
  registeredSettingsPlugins().flatMap((id) =>
    pluginSettingProblems(id, pluginSettingsDecls(id), win),
  );
