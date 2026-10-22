// ?plugins=hello,counter,size100k,... : fake plugin backend + real fixture
// modules served by the e2e preview server (see fixtures/pluginServer.ts).
// ?plugins=stubs50 registers 50 inactive-by-use plugins (3 commands, 1 panel,
// 4 settings each) whose modules must never be fetched.
// ?enabled=none leaves every plugin off (the Plugins settings page turns them on).
import { ensureActive } from "../src/plugins/host";
import {
  getPluginCosts,
  getStubRegistrationMs,
} from "../src/plugins/host/cost";
import { setPluginsBackend } from "../src/plugins/host/backend";
import {
  createFakeBackend,
  makePluginInfo,
} from "../src/plugins/host/fakeBackend";
import { startPluginHost } from "../src/plugins/host/start";
import { updatePreferences } from "../src/vault/preferences";

import type { PluginInfo } from "../src/plugins/host/types";

// Served by fixtures/pluginServer.ts.
const FIXTURE_PREFIX = "/e2e-plugins/";

const command = (id: string, title: string) => ({
  id,
  title,
  keys: [],
  when: [],
  palette: true,
});

const sized = (id: string, label: string, mainBytes: number) =>
  makePluginInfo(id, {
    name: label,
    mainBytes,
    contributes: {
      commands: [command("run", `${label}: run`)],
      panels: [],
      settings: [],
    },
  });

export const FIXTURES: Record<string, () => PluginInfo> = {
  hello: () =>
    makePluginInfo("hello", {
      name: "Hello",
      contributes: {
        commands: [command("hello", "Hello: say hello")],
        panels: [],
        settings: [
          {
            key: "greeting",
            type: "string",
            title: "Greeting",
            default: "Hello",
          } as never,
        ],
      },
    }),
  counter: () =>
    makePluginInfo("counter", {
      name: "Counter",
      contributes: {
        commands: [],
        panels: [{ id: "counter", title: "Counter", icon: null, group: "top" }],
        settings: [],
      },
    }),
  crashy: () =>
    makePluginInfo("crashy", {
      name: "Crashy",
      contributes: {
        commands: [command("boom", "Crashy: explode")],
        panels: [],
        settings: [],
      },
    }),
  size5k: () => sized("size5k", "Size 5k", 5 * 1024),
  size100k: () => sized("size100k", "Size 100k", 100 * 1024),
  size1m: () => sized("size1m", "Size 1m", 1024 * 1024),
};

/** 50 manifests x (3 commands, 1 panel, 4 settings). */
const stubPlugins = (n: number): PluginInfo[] =>
  Array.from({ length: n }, (_, i) =>
    makePluginInfo(`stub-${i}`, {
      name: `Stub ${i}`,
      contributes: {
        commands: [0, 1, 2].map((c) =>
          command(`cmd${c}`, `Stub ${i}: cmd ${c}`),
        ),
        panels: [
          { id: "p", title: `Stub ${i} panel`, icon: null, group: "top" },
        ],
        settings: [0, 1, 2, 3].map(
          (s) =>
            ({
              key: `s${s}`,
              type: "string",
              title: `Setting ${s}`,
              default: "x",
            } as never),
        ),
      },
    }),
  );

export async function startPluginsHarness(
  win: Window,
  params: URLSearchParams,
): Promise<void> {
  const names = (params.get("plugins") ?? "").split(",").filter(Boolean);
  const infos = names.flatMap((n) =>
    n === "stubs50" ? stubPlugins(50) : FIXTURES[n] ? [FIXTURES[n]()] : [],
  );
  setPluginsBackend(
    createFakeBackend(infos, (id, path) => `${FIXTURE_PREFIX}${id}/${path}`),
  );
  updatePreferences(
    {
      pluginsEnabled:
        params.get("enabled") === "none" ? [] : infos.map((p) => p.id),
    },
    win,
  );
  const host = await startPluginHost(win, (run) => win.setTimeout(run, 0));
  (win as any).__plugins = {
    host,
    ensureActive,
    getPluginCosts,
    getStubRegistrationMs,
  };
  (win as any).__pluginsReady = true;
}
