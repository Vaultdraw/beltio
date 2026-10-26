/**
 * The effective set of built-in extensions: each switch from preferences
 * (`[extensions]`, live), all off during a core-only safe start. Components
 * read it with `useExtensions`; a toggle re-renders only when the set changes.
 */
import { useSyncExternalStore } from "react";

import {
  getPreferences,
  subscribePreferences,
  type PreferencesSnapshot,
} from "../vault/preferences";

import { isCoreSafeStart, subscribeSafeStart } from "../safeStart/state";

import { EXTENSION_FIELDS, EXTENSION_IDS, type ExtensionId } from "./registry";

export type ExtensionSet = Readonly<Record<ExtensionId, boolean>>;

/** Pure: the switches in `prefs`, or everything off in safe start. */
export const effectiveExtensions = (
  prefs: Pick<PreferencesSnapshot, typeof EXTENSION_FIELDS[ExtensionId]>,
  safe: boolean,
): ExtensionSet =>
  Object.fromEntries(
    EXTENSION_IDS.map((id) => [id, !safe && prefs[EXTENSION_FIELDS[id]]]),
  ) as Record<ExtensionId, boolean>;

/** Core-only safe start (src/safeStart): every extension reads as off. */
export const isExtensionsSafeOverlay = (): boolean => isCoreSafeStart();

// ---- snapshot, stable while nothing changes ------------------------------
let cachedKey = "";
let cached: ExtensionSet | null = null;

/** The current effective set; the same object until a switch changes. */
export function getExtensions(win?: Window | null): ExtensionSet {
  const next = effectiveExtensions(getPreferences(win), isCoreSafeStart());
  const key = EXTENSION_IDS.map((id) => (next[id] ? "1" : "0")).join("");
  if (!cached || key !== cachedKey) {
    cachedKey = key;
    cached = next;
  }
  return cached;
}

export const isExtensionOn = (id: ExtensionId, win?: Window | null): boolean =>
  getExtensions(win)[id];

const subscribe = (listener: () => void) => {
  const offPrefs = subscribePreferences(listener);
  const offSafe = subscribeSafeStart(listener);
  return () => {
    offPrefs();
    offSafe();
  };
};

/** Live effective set; re-renders only when an extension turns on or off. */
export function useExtensions(win?: Window | null): ExtensionSet {
  return useSyncExternalStore(subscribe, () => getExtensions(win));
}

/** Live switch of one extension. */
export function useExtension(id: ExtensionId, win?: Window | null): boolean {
  return useSyncExternalStore(subscribe, () => getExtensions(win)[id]);
}
