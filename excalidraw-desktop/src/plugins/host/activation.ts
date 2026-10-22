/**
 * Per-plugin activation: idle -> loading -> active | failed | disabled.
 * One shared promise per plugin, so concurrent triggers activate it once.
 */
import { toastStore } from "../../toasts/toastStore";

import { getPluginsBackend } from "./backend";
import { createPluginContext } from "./context";
import { recordActivate } from "./cost";
import {
  errorText,
  reportPluginError,
  resetPluginErrors,
  setCrashHandler,
} from "./errors";
import { acquireGlobalGuards, guard, releaseGlobalGuards } from "./guard";
import { loadPluginModule } from "./loader";

import type { PluginInfo, PluginRuntime } from "./types";

export const DEACTIVATE_TIMEOUT_MS = 2000;

const runtimes = new Map<string, PluginRuntime>();
const runtimeListeners = new Set<() => void>();
let hostWindow: Window | null = null;

export const setActivationWindow = (win: Window): void => {
  hostWindow = win;
};

/** Notified after every runtime state change (the management state listens). */
export function subscribeRuntimes(listener: () => void): () => void {
  runtimeListeners.add(listener);
  return () => {
    runtimeListeners.delete(listener);
  };
}
const runtimesChanged = () => runtimeListeners.forEach((l) => l());

export const getRuntime = (id: string): PluginRuntime | undefined =>
  runtimes.get(id);
export const allRuntimes = (): PluginRuntime[] => [...runtimes.values()];

/** The runtime record for `info`; its info (hostDisabled, ...) is refreshed. */
export function ensureRuntime(info: PluginInfo): PluginRuntime {
  let rt = runtimes.get(info.id);
  if (!rt) {
    rt = {
      info,
      state: "idle",
      promise: null,
      gen: 0,
      plugin: null,
      handlers: new Map(),
      components: new Map(),
      disposeContext: null,
      disposeStubs: null,
    };
    runtimes.set(info.id, rt);
    runtimesChanged();
  } else {
    rt.info = info;
  }
  return rt;
}

/** Resolves true once the plugin is active; false if it cannot be (never rejects). */
export function ensureActive(id: string): Promise<boolean> {
  const rt = runtimes.get(id);
  if (!rt || rt.state === "disabled" || rt.state === "failed") {
    return Promise.resolve(false);
  }
  if (!rt.promise) {
    rt.state = "loading";
    rt.promise = activate(rt);
    runtimesChanged();
  }
  return rt.promise;
}

async function activate(rt: PluginRuntime): Promise<boolean> {
  const { id } = rt.info;
  const gen = rt.gen;
  const win = hostWindow ?? window;
  try {
    rt.plugin ??= await loadPluginModule(rt.info);
    if (rt.gen !== gen) {
      return false;
    }
    const start = performance.now();
    const handle = createPluginContext(rt, win);
    rt.disposeContext = handle.dispose;
    acquireGlobalGuards(win);
    await rt.plugin.activate(handle.ctx);
    recordActivate(id, performance.now() - start, start);
    if (rt.gen !== gen) {
      return false;
    }
    rt.state = "active";
    runtimesChanged();
    return true;
  } catch (err) {
    if (rt.gen !== gen) {
      return false;
    }
    rt.state = "failed";
    runtimesChanged();
    reportPluginError(id, err, "activate");
    disablePlugin(id, `failed to activate: ${errorText(err)}`);
    return false;
  }
}

const withTimeout = (p: Promise<unknown> | undefined, ms: number) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    void Promise.resolve(p).finally(() => {
      clearTimeout(t);
      resolve();
    });
  });

/** Calls deactivate() (2 s limit) and disposes the context. Stubs stay. */
export async function deactivate(rt: PluginRuntime): Promise<void> {
  const wasActive = rt.state === "active";
  const had = rt.disposeContext;
  rt.gen++;
  rt.promise = null;
  rt.disposeContext = null;
  if (wasActive && rt.plugin?.deactivate) {
    const call = guard(
      rt.info.id,
      rt.plugin.deactivate.bind(rt.plugin),
      "deactivate",
    );
    await withTimeout(
      call() as Promise<unknown> | undefined,
      DEACTIVATE_TIMEOUT_MS,
    );
  }
  if (had) {
    had();
    releaseGlobalGuards();
  }
  rt.handlers.clear();
  rt.components.clear();
}

/** Disposes stubs and context (not cached module); back to idle for re-enable. */
export function stopPlugin(rt: PluginRuntime): Promise<void> {
  rt.disposeStubs?.();
  rt.disposeStubs = null;
  const done = deactivate(rt);
  rt.state = "idle";
  runtimesChanged();
  return done;
}

/** Host-side disable after a crash or failed activation. */
export function disablePlugin(id: string, reason: string): void {
  const rt = runtimes.get(id);
  if (!rt || rt.state === "disabled") {
    return;
  }
  rt.info = { ...rt.info, hostDisabled: reason };
  void stopPlugin(rt);
  rt.state = "disabled";
  runtimesChanged();
  toastStore.push({
    message: `Plugin ${rt.info.name} was disabled: ${reason}`,
    kind: "error",
  });
  void getPluginsBackend()
    .setHostDisabled(id, reason)
    .catch((err) => console.error("setHostDisabled failed", err));
}

/** The user re-enabled a plugin the host had disabled. */
export function clearHostDisabled(id: string): void {
  const rt = runtimes.get(id);
  if (rt) {
    rt.info = { ...rt.info, hostDisabled: null };
    rt.state = "idle";
    runtimesChanged();
  }
  resetPluginErrors(id);
}

setCrashHandler(disablePlugin);

export function resetActivation(): void {
  runtimes.clear();
  hostWindow = null;
}
