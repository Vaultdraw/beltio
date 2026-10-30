/**
 * Tiny eager store: "Run setup again" asks the app shell to show the setup.
 * The setup itself is a lazy chunk (SetupWizard); this file is a few lines.
 */
import { useSyncExternalStore } from "react";

let requested = false;
const listeners = new Set<() => void>();

const set = (next: boolean) => {
  if (requested !== next) {
    requested = next;
    listeners.forEach((l) => l());
  }
};

export const requestSetup = () => set(true);
export const closeSetup = () => set(false);
export const isSetupRequested = () => requested;
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
export const useSetupRequested = (): boolean =>
  useSyncExternalStore(subscribe, isSetupRequested, isSetupRequested);
