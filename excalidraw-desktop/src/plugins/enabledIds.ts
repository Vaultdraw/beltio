/**
 * The plugin ids that are on right now: the saved `plugins.enabled` list, except that an official
 * plugin tied to an `[extensions]` switch (officialPlugins.ts `extension`) is on only while that
 * switch is on too (the effective extension set: not in safe start or bisect) and it is not in
 * `plugins.disabled`. One place, so the stubs, the host and Settings agree.
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
  const off = new Set(LINKED.filter(([, key]) => !ext[key]).map(([id]) => id));
  return listed.filter((id) => !off.has(id));
}

/** True when `id` is an official plugin that an `[extensions]` switch controls. */
export const isExtensionLinked = (id: string): boolean =>
  LINKED.some(([linked]) => linked === id);

/** The `[extensions]` key behind a linked plugin id. */
export const extensionOf = (
  id: string,
): "graph" | "mermaid" | "formula" | undefined =>
  LINKED.find(([linked]) => linked === id)?.[1];
