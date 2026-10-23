/**
 * Management API for the Settings page: state snapshot, rescan, reload, install,
 * uninstall, host-disable reset and safe-mode restart.
 */
import { updatePreferences, getPreferences } from "../../vault/preferences";
import { ensurePluginHost } from "../boot";
import { pluginHostStarted } from "../hostFlag";

import {
  getRuntime,
  stopPlugin,
  clearHostDisabled as resetRuntimeDisabled,
} from "./activation";
import { applyPlugins, idleSchedule } from "./apply";
import { getPluginsBackend } from "./backend";
import { logLine, resetPluginErrors } from "./errors";
import { forgetPluginModule } from "./loader";
import { currentList, setPluginsList } from "./pluginsState";

import { ensureActive } from "./index";

import type { PluginInfo } from "./types";

export { getPluginsState, subscribePluginsState } from "./pluginsState";
export { getPluginCosts } from "./cost";
export type { PluginsState, SafeModeInfo } from "./types";

/** After this many dev reloads of one plugin the log suggests a restart. */
export const RELOAD_HINT_EVERY = 20;

const reapply = () => applyPlugins(window, idleSchedule(window));

/**
 * Re-reads the plugin folders; new plugins appear, removed ones are disposed.
 * With no plugin enabled the host hasn't started: this starts it first.
 */
export async function rescanPlugins(): Promise<void> {
  if (!pluginHostStarted.get()) {
    await ensurePluginHost(window);
  }
  setPluginsList(await getPluginsBackend().list(true));
  void reapply();
  ensureDevListener();
}

/** Drops everything a plugin holds so its next activation imports fresh code. */
async function dispose(id: string): Promise<void> {
  const rt = getRuntime(id);
  if (rt) {
    await stopPlugin(rt);
    rt.plugin = null;
  }
  forgetPluginModule(id);
}

const reloads = new Map<string, number>();
const chains = new Map<string, Promise<void>>();

async function doReload(id: string): Promise<void> {
  const before = getRuntime(id);
  // A dev plugin the host stopped after errors is retried on the next save.
  const wasActive =
    before?.state === "active" ||
    (before?.info.dev === true && before.state === "disabled");
  await dispose(id);
  resetPluginErrors(id);
  await rescanPlugins();
  const n = (reloads.get(id) ?? 0) + 1;
  reloads.set(id, n);
  if (n % RELOAD_HINT_EVERY === 0) {
    logLine(id, "info", `reloaded ${n} times: restart to free memory`);
  }
  if (wasActive) {
    await ensureActive(id);
  }
}

/** Dispose, re-import with `?t=<n>` and re-register; re-activates only if it was active. */
export function reloadPlugin(id: string): Promise<void> {
  const run = (chains.get(id) ?? Promise.resolve()).then(() => doReload(id));
  const tail = run.catch(() => {});
  chains.set(id, tail);
  void tail.then(() => chains.get(id) === tail && chains.delete(id));
  return run;
}

let offDev: Promise<() => void> | null = null;

/** Listens for dev file changes once any dev plugin exists (nothing otherwise). */
export function ensureDevListener(): void {
  if (offDev || !currentList().plugins.some((p) => p.dev)) {
    return;
  }
  offDev = getPluginsBackend()
    .onChanged((id) => void reloadPlugin(id).catch(console.error))
    .catch((err) => {
      offDev = null;
      console.error("plugin dev listener failed", err);
      return () => {};
    });
}

export async function stopDevListener(): Promise<void> {
  const off = offDev;
  offDev = null;
  (await off)?.();
}

/** Installs a folder; the plugin is added disabled. */
export async function installPluginFolder(path: string): Promise<PluginInfo> {
  const info = await getPluginsBackend().installFolder(path);
  await rescanPlugins();
  return info;
}

export async function uninstallPlugin(id: string): Promise<void> {
  await dispose(id);
  resetPluginErrors(id);
  await getPluginsBackend().uninstall(id);
  const enabled = getPreferences().pluginsEnabled;
  if (enabled.includes(id)) {
    updatePreferences({ pluginsEnabled: enabled.filter((x) => x !== id) });
  }
  await rescanPlugins();
}

/** The user re-enabled a plugin the host had disabled after errors. */
export async function clearHostDisabled(id: string): Promise<void> {
  await getPluginsBackend().setHostDisabled(id, null);
  resetRuntimeDisabled(id);
  await rescanPlugins();
}

export const restartInSafeMode = (): Promise<void> =>
  getPluginsBackend().restartSafeMode();

export const pickPluginFolder = (): Promise<string | null> =>
  getPluginsBackend().pickFolder();

/** Shows a plugin's folder (matched by path) in the file manager; the plugins folder if unknown. */
export const revealPluginFolder = (dir: string): Promise<void> =>
  getPluginsBackend().openDir(
    currentList().plugins.find((p) => p.dir === dir)?.id ?? null,
  );

/** Shows the plugins folder itself in the file manager. */
export const openPluginsFolder = (): Promise<void> =>
  getPluginsBackend().openDir(null);
