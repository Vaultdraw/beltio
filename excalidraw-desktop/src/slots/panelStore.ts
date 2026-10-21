/**
 * Open flags of panels by id, on the shared flag store. A panel's host, its
 * activity bar button and any command read and write the same flag.
 */
import { useSyncExternalStore } from "react";

import { createFlagStore, type FlagStore } from "../activityBar/flagStore";

const stores = new Map<string, FlagStore>();

/** The flag store behind a panel id (created on first use). */
export function panelFlag(id: string): FlagStore {
  let store = stores.get(id);
  if (!store) {
    store = createFlagStore();
    stores.set(id, store);
  }
  return store;
}

export const openPanel = (id: string): void => panelFlag(id).publish(true);
export const closePanel = (id: string): void => panelFlag(id).publish(false);
export const togglePanel = (id: string): void => {
  const flag = panelFlag(id);
  flag.publish(!flag.get());
};
export const isPanelOpen = (id: string): boolean => panelFlag(id).get();
export const subscribePanel = (id: string, listener: () => void) =>
  panelFlag(id).subscribe(listener);

export const usePanelOpen = (id: string): boolean => {
  const flag = panelFlag(id);
  return useSyncExternalStore(flag.subscribe, flag.get, () => false);
};
