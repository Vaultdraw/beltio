/** In-memory PluginsBackend for vitest and the e2e harness. */
import type { PluginsBackend } from "./backend";
import type { PluginInfo, SafeModeInfo } from "./types";

export interface FakeBackend extends PluginsBackend {
  plugins: PluginInfo[];
  hostDisabledCalls: { id: string; reason: string | null }[];
  safeMode: SafeModeInfo | null;
  /** Folders `installFolder` can install, by path. */
  installable: Record<string, PluginInfo>;
  launchOkCalls: number;
  restarts: ("safe" | "normal")[];
  pickResult: string | null;
  opened: (string | null)[];
  /** Simulates a dev file change. */
  emitChanged(id: string): void;
}

export function createFakeBackend(
  plugins: PluginInfo[] = [],
  moduleUrl: (id: string, path: string) => string = (id, path) =>
    `fake://plugin/${id}/${path}`,
): FakeBackend {
  const listeners = new Set<(id: string) => void>();
  const fake: FakeBackend = {
    plugins,
    hostDisabledCalls: [],
    safeMode: null,
    installable: {},
    launchOkCalls: 0,
    restarts: [],
    pickResult: null,
    opened: [],
    openDir: async (id) => {
      fake.opened.push(id);
    },
    list: async () => ({
      plugins: fake.plugins,
      errors: [],
      scanMs: 0,
      safeMode: fake.safeMode,
    }),
    installFolder: async (path) => {
      const info = fake.installable[path];
      if (!info) {
        throw new Error(`cannot install ${path}`);
      }
      fake.plugins = [...fake.plugins.filter((p) => p.id !== info.id), info];
      return info;
    },
    launchOk: async () => {
      fake.launchOkCalls++;
    },
    restartSafeMode: async () => {
      fake.restarts.push("safe");
    },
    restart: async () => {
      fake.restarts.push("normal");
    },
    pickFolder: async () => fake.pickResult,
    onChanged: async (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    emitChanged: (id) => listeners.forEach((cb) => cb(id)),
    uninstall: async (id) => {
      fake.plugins = fake.plugins.filter((p) => p.id !== id);
    },
    setHostDisabled: async (id, reason) => {
      fake.hostDisabledCalls.push({ id, reason });
      fake.plugins = fake.plugins.map((p) =>
        p.id === id ? { ...p, hostDisabled: reason } : p,
      );
    },
    moduleUrl,
  };
  return fake;
}

/** A compatible, enabled-able PluginInfo with no contributions. */
export const makePluginInfo = (
  id: string,
  patch: Partial<PluginInfo> = {},
): PluginInfo => ({
  id,
  name: id,
  version: "0.1.0",
  api: 0,
  minApp: null,
  main: "main.js",
  description: null,
  author: null,
  source: "user",
  dir: `/plugins/${id}`,
  mainBytes: 1000,
  compatible: true,
  problem: null,
  hostDisabled: null,
  activation: [],
  contributes: { commands: [], panels: [], settings: [] },
  ...patch,
});
