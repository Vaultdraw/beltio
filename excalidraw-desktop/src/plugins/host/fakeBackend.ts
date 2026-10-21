/** In-memory PluginsBackend for vitest and the e2e harness. */
import type { PluginsBackend } from "./backend";
import type { PluginInfo } from "./types";

export interface FakeBackend extends PluginsBackend {
  plugins: PluginInfo[];
  hostDisabledCalls: { id: string; reason: string | null }[];
}

export function createFakeBackend(
  plugins: PluginInfo[] = [],
  moduleUrl: (id: string, path: string) => string = (id, path) =>
    `fake://plugin/${id}/${path}`,
): FakeBackend {
  const fake: FakeBackend = {
    plugins,
    hostDisabledCalls: [],
    list: async () => ({ plugins: fake.plugins, errors: [], scanMs: 0 }),
    installFolder: async () => {
      throw new Error("not supported by the fake backend");
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
  contributes: { commands: [], panels: [], settings: [] },
  ...patch,
});
