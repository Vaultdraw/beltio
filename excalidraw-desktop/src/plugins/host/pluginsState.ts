/**
 * The management snapshot: the last plugin list plus live runtime states.
 * Cached, so `getPluginsState` is stable between changes (useSyncExternalStore).
 */
import { getPreferences, subscribePreferences } from "../../vault/preferences";

import { allRuntimes, subscribeRuntimes } from "./activation";

import type { PluginsList, PluginsState } from "./types";

const EMPTY: PluginsList = {
  plugins: [],
  errors: [],
  scanMs: 0,
  safeMode: null,
};

let list: PluginsList = EMPTY;
let cached: PluginsState | null = null;
const listeners = new Set<() => void>();
let detach: (() => void) | null = null;

export const currentList = (): PluginsList => list;

function invalidate(): void {
  cached = null;
  listeners.forEach((l) => l());
}

export function setPluginsList(next: PluginsList): void {
  list = next;
  invalidate();
}

function compute(): PluginsState {
  const enabled = new Set(getPreferences().pluginsEnabled);
  const states = new Map(allRuntimes().map((rt) => [rt.info.id, rt.state]));
  const runtime: PluginsState["runtime"] = {};
  for (const p of list.plugins) {
    runtime[p.id] = {
      state: states.get(p.id) ?? "idle",
      enabled: enabled.has(p.id),
    };
  }
  return { ...list, runtime };
}

export const getPluginsState = (): PluginsState => (cached ??= compute());

/** Listens to runtime and preference changes only while someone subscribes. */
export function subscribePluginsState(cb: () => void): () => void {
  listeners.add(cb);
  if (!detach) {
    const offRuntime = subscribeRuntimes(invalidate);
    let key = JSON.stringify(getPreferences().pluginsEnabled);
    const offPrefs = subscribePreferences(() => {
      const next = JSON.stringify(getPreferences().pluginsEnabled);
      if (next !== key) {
        key = next;
        invalidate();
      }
    });
    detach = () => {
      offRuntime();
      offPrefs();
    };
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0) {
      detach?.();
      detach = null;
    }
  };
}

export function resetPluginsState(): void {
  list = EMPTY;
  cached = null;
}
