/**
 * The plugin ids that are on right now: the saved `plugins.enabled` list, except that an official
 * plugin tied to an `[extensions]` switch (officialPlugins.ts `extension`) follows that switch
 * instead (it is on while the effective extension set has it on: not in safe start or bisect).
 * One place, so the stubs, the host and Settings agree.
 */
import { getExtensions } from "../extensionSwitches/useExtensions";
import { getPreferences } from "../vault/preferences";

import { OFFICIAL_PLUGINS } from "./officialPlugins";

const LINKED = OFFICIAL_PLUGINS.flatMap((p) =>
  p.extension ? [[p.id, p.extension] as const] : [],
);

export function enabledPluginIds(win?: Window | null): string[] {
  const listed = getPreferences(win).pluginsEnabled;
  if (LINKED.length === 0) {
    return [...listed];
  }
  const ext = getExtensions(win);
  const linked = new Set(LINKED.map(([id]) => id));
  return [
    ...listed.filter((id) => !linked.has(id)),
    ...LINKED.filter(([, key]) => ext[key]).map(([id]) => id),
  ];
}

/** True when `id` is an official plugin that an `[extensions]` switch controls. */
export const isExtensionLinked = (id: string): boolean =>
  LINKED.some(([linked]) => linked === id);

/** The `[extensions]` key behind a linked plugin id. */
export const extensionOf = (id: string): "graph" | undefined =>
  LINKED.find(([linked]) => linked === id)?.[1];
