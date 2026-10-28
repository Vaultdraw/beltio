/** Plugin panels currently registered as stubs, for the PluginPanels host to mount. */
import { closePanel } from "../slots/panelStore";

import type { ComponentType } from "react";

export interface PluginPanelStub {
  /** Panel flag id and activity entry id: `<pluginId>.<panelId>`. */
  id: string;
  pluginId: string;
  title: string;
  load: () => Promise<{ default: ComponentType }>;
}

let panels: readonly PluginPanelStub[] = [];
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

export function addPluginPanels(added: readonly PluginPanelStub[]): () => void {
  if (added.length === 0) {
    return () => {};
  }
  panels = [...panels, ...added];
  emit();
  return () => {
    panels = panels.filter((p) => !added.includes(p));
    // Disable, reload and uninstall dispose the stubs: the open flags reset.
    added.forEach((p) => closePanel(p.id));
    emit();
  };
}

export const getPluginPanels = (): readonly PluginPanelStub[] => panels;
export const subscribePluginPanels = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
