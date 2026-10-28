/**
 * The management snapshot: the last plugin list plus live runtime states.
 * Cached, so `getPluginsState` is stable between changes (useSyncExternalStore).
 */
import { subscribePreferences } from "../../vault/preferences";
import { enabledPluginIds } from "../enabledIds";

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
  const enabled = new Set(enabledPluginIds());
  const runtimes = allRuntimes();
  const states = new Map(runtimes.map((rt) => [rt.info.id, rt.state]));
  // The host disables a plugin after repeated errors (activation.ts); the saved list still says
  // `hostDisabled: null` until the next rescan, so the runtime's reason is shown meanwhile.
  const hostDisabled = new Map(
    runtimes.flatMap((rt) =>
      rt.state === "disabled" && rt.info.hostDisabled
        ? [[rt.info.id, rt.info.hostDisabled] as const]
        : [],
    ),
  );
  const plugins = list.plugins.map((p) =>
    !p.hostDisabled && hostDisabled.has(p.id)
      ? { ...p, hostDisabled: hostDisabled.get(p.id)! }
      : p,
  );
  const runtime: PluginsState["runtime"] = {};
  for (const p of plugins) {
    runtime[p.id] = {
      state: states.get(p.id) ?? "idle",
      enabled: enabled.has(p.id),
    };
  }
  return { ...list, plugins, runtime };
}

export const getPluginsState = (): PluginsState => (cached ??= compute());

/** Listens to runtime and preference changes only while someone subscribes. */
export function subscribePluginsState(cb: () => void): () => void {
  listeners.add(cb);
  if (!detach) {
    // Nobody listened while the page was closed, so the cached snapshot may be old.
    cached = null;
    const offRuntime = subscribeRuntimes(invalidate);
    let key = JSON.stringify(enabledPluginIds());
    const offPrefs = subscribePreferences(() => {
      const next = JSON.stringify(enabledPluginIds());
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
