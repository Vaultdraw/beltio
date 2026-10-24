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
  /** Plugin ids the user confirmed the permissions of. */
  consentCalls: string[];
  restarts: ("safe" | "normal")[];
  pickResult: string | null;
  opened: (string | null)[];
  /** Simulates a dev file change. */
  emitChanged(id: string): void;
  /** Saved plugin data (`storage.global`) as the JSON text Rust would hold, by id. */
  data: Record<string, string>;
  /** Every gateway call, in order. */
  gatewayCalls: { pluginId: string; method: string; params: unknown }[];
}

/** An error as the gateway reports it (`code` plus message). */
const coded = (code: string, message: string) =>
  Object.assign(new Error(message), { code });

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
    consentCalls: [],
    restarts: [],
    pickResult: null,
    opened: [],
    data: {},
    gatewayCalls: [],
    // The storage rows of the Rust gateway (plugins/gateway.rs); other rows are not faked.
    pluginCall: async (pluginId, method, params) => {
      fake.gatewayCalls.push({ pluginId, method, params });
      if (!fake.plugins.some((p) => p.id === pluginId)) {
        throw coded(
          "NOT_FOUND",
          `No installed plugin has the id "${pluginId}"`,
        );
      }
      if (method === "storage.read") {
        const text = fake.data[pluginId];
        return {
          data: text === undefined ? null : JSON.parse(text),
          corrupt: false,
        };
      }
      if (method === "storage.write") {
        fake.data[pluginId] = String(params?.text);
        return null;
      }
      throw coded("NOT_FOUND", `Plugins cannot call "${method}"`);
    },
    dataList: async () =>
      Object.entries(fake.data)
        .map(([id, text]) => ({
          id,
          bytes: new TextEncoder().encode(text).length,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    dataDelete: async (id) => {
      const had = id in fake.data;
      delete fake.data[id];
      return had;
    },
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
    consentConfirm: async (id, _seen) => {
      fake.consentCalls.push(id);
      fake.plugins = fake.plugins.map((p) =>
        p.id === id ? { ...p, review: { state: "ok", added: [] } } : p,
      );
    },
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
  permissions: [],
  review: { state: "ok", added: [] },
  contributes: { commands: [], panels: [], settings: [] },
  ...patch,
});
