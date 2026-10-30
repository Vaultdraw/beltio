/** Loads the plugins list (cache first, one fetch when stale) and works out what each entry means for this machine. */

import {
  browserCatalogueBackend,
  PLUGIN_CACHE_KEY,
  tauriCatalogueBackend,
} from "../../theme/catalogue/backends";
import { loadIndex } from "../../theme/catalogue/client";
import { isTauriAvailable } from "../../vault/DesktopVaultRepository";

import { parseRegistryIndex } from "./parseIndex";

import type {
  CatalogueBackend,
  LoadedCatalogue,
} from "../../theme/catalogue/types";
import type { LoadOptions } from "../../theme/catalogue/client";
import type { RegistryEntry, RegistryStatus } from "./types";

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

export const loadRegistry = (
  backend: CatalogueBackend,
  options: LoadOptions,
): Promise<LoadedCatalogue<RegistryEntry>> =>
  loadIndex(backend, parseRegistryIndex, options);

export const getRegistryBackend = async (
  win: Window,
): Promise<CatalogueBackend> => {
  if (isTauriAvailable(win)) {
    const { invoke } = await import("@tauri-apps/api/core");
    return tauriCatalogueBackend(invoke as Invoke, {
      cached: "plugin_registry_cached",
      refresh: "plugin_registry_index",
    });
  }
  return browserCatalogueBackend(
    win,
    PLUGIN_CACHE_KEY,
    "The plugins list is not valid JSON",
    "networkAllowPlugins",
  );
};

const parts = (v: string): number[] =>
  v
    .split(/[-+]/)[0]
    .split(".")
    .map((n) => Number.parseInt(n, 10) || 0);

/** Negative, zero or positive like a comparator (pre-release tags are ignored: 1.0.0-beta equals 1.0.0). */
export const compareVersions = (a: string, b: string): number => {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) {
      return d;
    }
  }
  return 0;
};

/** Not installed, installed and current, or the list has a newer version than the installed one. */
export const registryStatus = (
  entry: RegistryEntry,
  installedVersion: string | undefined,
): RegistryStatus =>
  installedVersion === undefined
    ? "available"
    : compareVersions(entry.version, installedVersion) > 0
    ? "update"
    : "installed";

/** Case-insensitive match on id, name, author and description; every word must match. */
export const searchRegistry = (
  entries: readonly RegistryEntry[],
  query: string,
): RegistryEntry[] => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [...entries];
  }
  return entries.filter((e) => {
    const hay = `${e.id} ${e.name} ${e.author} ${e.description}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
};

/** The desktop install: Rust downloads, checks and installs the plugin the cached list names. */
export const installFromRegistry = async (id: string): Promise<void> => {
  const { invoke } = await import("@tauri-apps/api/core");
  await (invoke as Invoke)("plugin_registry_install", { id });
};
