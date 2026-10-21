/**
 * The dynamic `[plugin.<id>]` tables of config.toml and a vault's
 * settings.toml (one table per plugin, one key per declared setting), so they
 * are not CONFIG_MAPPING rows. Parsing needs no schema: schemas register at
 * runtime and values are checked against them when read.
 *
 * Writes are one `plugin.<id>` change per plugin carrying all of its keys
 * (the same shape as `[tools.<tool>]`); null removes the table.
 */
import type { SettingsProblem } from "./settingsSync";

export type PluginSettingValue = string | number | boolean;
export type PluginValues = Record<string, PluginSettingValue>;
/** plugin id -> key -> value. */
export type PluginSettingsMap = Record<string, PluginValues>;

const ID_RE = /^[a-z0-9-]+$/;
const KEY_RE = /^[A-Za-z0-9_-]+$/;

const isTable = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

const isScalar = (v: unknown): v is PluginSettingValue =>
  typeof v === "boolean" ||
  typeof v === "string" ||
  (typeof v === "number" && Number.isFinite(v));

/** Valid entries of a `[plugin]` table; every rejected one is a problem. */
export function parsePluginTable(
  table: unknown,
  file: string,
): { settings: PluginSettingsMap; problems: SettingsProblem[] } {
  const settings: PluginSettingsMap = {};
  const problems: SettingsProblem[] = [];
  if (table === undefined) {
    return { settings, problems };
  }
  const bad = (key: string, why: string) =>
    problems.push({ kind: "invalid", key, message: `${file}: ${key} ${why}` });
  if (!isTable(table)) {
    bad("plugin", "is not a table; ignored");
    return { settings, problems };
  }
  for (const [id, values] of Object.entries(table)) {
    const idKey = `plugin.${id}`;
    if (!ID_RE.test(id)) {
      bad(idKey, "is not a valid plugin id (a-z, 0-9, -); ignored");
    } else if (!isTable(values)) {
      bad(idKey, "is not a table; ignored");
    } else {
      const kept: PluginValues = {};
      for (const [key, value] of Object.entries(values)) {
        if (!KEY_RE.test(key)) {
          bad(`${idKey}.${key}`, "is not a valid setting key; ignored");
        } else if (!isScalar(value)) {
          bad(
            `${idKey}.${key}`,
            "must be a string, number or boolean; ignored",
          );
        } else {
          kept[key] = value;
        }
      }
      if (Object.keys(kept).length > 0) {
        settings[id] = kept;
      }
    }
  }
  return { settings, problems };
}

/** Silent version for the localStorage copy of the preferences. */
export const normalizePluginSettings = (value: unknown): PluginSettingsMap =>
  parsePluginTable(value, "").settings;

const same = (a: PluginValues | undefined, b: PluginValues | undefined) =>
  JSON.stringify(sortedValues(a)) === JSON.stringify(sortedValues(b));

const sortedValues = (v: PluginValues | undefined) =>
  Object.entries(v ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));

/** Stable form for change detection: file order must not count as a change. */
export const sortedPluginSettings = (map: PluginSettingsMap) =>
  Object.entries(map)
    .map(([id, values]) => [id, sortedValues(values)] as const)
    .sort(([a], [b]) => (a < b ? -1 : 1));

/** One change per plugin whose values differ; null deletes its table. */
export function pluginSettingsChanges(
  prev: PluginSettingsMap,
  next: PluginSettingsMap,
): { key: string; value: PluginValues | null }[] {
  const changes: { key: string; value: PluginValues | null }[] = [];
  for (const id of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    if (!same(prev[id], next[id])) {
      const now = next[id];
      changes.push({
        key: `plugin.${id}`,
        value: now && Object.keys(now).length > 0 ? now : null,
      });
    }
  }
  return changes;
}

/** `map` with one key set (or, with undefined, removed); emptied ids vanish. */
export function withPluginValue(
  map: PluginSettingsMap,
  id: string,
  key: string,
  value: PluginSettingValue | undefined,
): PluginSettingsMap {
  const values = { ...map[id] };
  if (value === undefined) {
    delete values[key];
  } else {
    values[key] = value;
  }
  const { [id]: _old, ...rest } = map;
  return Object.keys(values).length > 0 ? { ...rest, [id]: values } : rest;
}

export const isPluginId = (id: string) => ID_RE.test(id);
export const isPluginKey = (key: string) => KEY_RE.test(key);
