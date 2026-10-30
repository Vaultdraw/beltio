// ?plugins=hello,counter,size100k,... : fake plugin backend + real fixture
// modules served by the e2e preview server (see fixtures/pluginServer.ts).
// ?plugins=<sdk example id> fetches its manifest from /e2e-plugins/<id>/plugin.json.
// ?pluginsOff=<ids> lists plugins in the backend without enabling them.
// ?plugins=stubs50 registers 50 inactive-by-use plugins (3 commands, 1 panel,
// 4 settings each) whose modules must never be fetched.
// ?enabled=none leaves every plugin off (the Plugins settings page turns them on).
// ?pluginData=<ids> gives those plugins saved ctx.storage data (Delete data).
import { registeredCommands } from "../src/commands/registry";
import { ensureActive } from "../src/plugins/host";
import { getPluginLog } from "../src/plugins/host/errors";
import {
  getPluginCosts,
  getStubRegistrationMs,
} from "../src/plugins/host/cost";
import { setPluginsBackend } from "../src/plugins/host/backend";
import {
  createFakeBackend,
  readThroughVault,
  makePluginInfo,
} from "../src/plugins/host/fakeBackend";
import { startPluginHost } from "../src/plugins/host/start";
import {
  getPreferences,
  isOffline,
  updatePreferences,
} from "../src/vault/preferences";

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
  // Declares a write permission: the enable dialog lists it (consent record, no module needed).
  writer: () =>
    makePluginInfo("writer", {
      name: "Writer",
      permissions: ["vault.read", "vault.write"],
      review: { state: "review", added: ["vault.read", "vault.write"] },
    }),
  // Declares nothing and was never confirmed: still held back until the user reviews it.
  stranger: () =>
    makePluginInfo("stranger", {
      name: "Stranger",
      contributes: {
        commands: [command("stranger", "Stranger: say hi")],
        panels: [],
        settings: [],
      },
      review: { state: "review", added: [] },
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
  "md-api": () =>
    makePluginInfo("md-api", {
      name: "Markdown API",
      contributes: {
        commands: [],
        panels: [
          { id: "markdown", title: "Markdown API", icon: null, group: "top" },
        ],
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
  "scene-stamp": () =>
    makePluginInfo("scene-stamp", {
      name: "Stamp",
      contributes: {
        commands: [
          command("stamp", "Stamp: add box"),
          command("stamp100", "Stamp: add 100 boxes"),
        ],
        panels: [{ id: "stamp", title: "Stamp", icon: null, group: "top" }],
        settings: [],
      },
    }),
  "scene-watch": () =>
    makePluginInfo("scene-watch", {
      name: "Scene watch",
      activation: ["onStartupFinished"],
    }),
  size5k: () => sized("size5k", "Size 5k", 5 * 1024),
  size100k: () => sized("size100k", "Size 100k", 100 * 1024),
  size1m: () => sized("size1m", "Size 1m", 1024 * 1024),
};

/**
 * n manifests x (3 commands, 1 panel, 4 settings); `only` keeps one kind
 * (stubs50:commands | stubs50:panels | stubs50:settings) for cost attribution.
 */
const stubPlugins = (n: number, only?: string): PluginInfo[] =>
  Array.from({ length: n }, (_, i) =>
    makePluginInfo(`stub-${i}`, {
      name: `Stub ${i}`,
      contributes: {
        commands:
          only && only !== "commands"
            ? []
            : [0, 1, 2].map((c) => command(`cmd${c}`, `Stub ${i}: cmd ${c}`)),
        panels:
          only && only !== "panels"
            ? []
            : [{ id: "p", title: `Stub ${i} panel`, icon: null, group: "top" }],
        settings:
          only && only !== "settings"
            ? []
            : [0, 1, 2, 3].map(
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

const csv = (params: URLSearchParams, key: string) =>
  (params.get(key) ?? "").split(",").filter(Boolean);

async function manifestFor(name: string): Promise<PluginInfo[]> {
  if (name.startsWith("stubs50")) {
    return stubPlugins(50, name.split(":")[1]);
  }
  if (FIXTURES[name]) {
    return [FIXTURES[name]()];
  }
  const res = await fetch(`${FIXTURE_PREFIX}${name}/plugin.json`);
  return res.ok ? [(await res.json()) as PluginInfo] : [];
}

export async function startPluginsHarness(
  win: Window,
  params: URLSearchParams,
): Promise<void> {
  const on = (
    await Promise.all(csv(params, "plugins").map(manifestFor))
  ).flat();
  const off = (
    await Promise.all(csv(params, "pluginsOff").map(manifestFor))
  ).flat();
  const infos = [...on, ...off];
  const backend = createFakeBackend(
    infos,
    (id, path) => `${FIXTURE_PREFIX}${id}/${path}`,
    (path, scene) =>
      (win as any).__vaultRepo?.seedDrawing(path, JSON.stringify(scene)),
  );
  backend.network.offline = () => isOffline(getPreferences(win));
  // Plugins list and read the app's vault, as the native gateway does (one file list).
  readThroughVault(backend, () => (win as any).__vaultRepo);
  for (const id of csv(params, "pluginData")) {
    backend.data[id] = JSON.stringify({ notes: "x".repeat(12 * 1024) });
  }
  // The graph plugin's data (see harnessMain.tsx): the fake links as VDG1 bytes, the layout cache
  // in memory, and `[graph]` settings mirrored into the flat `graph.*` store the specs read.
  const graphBytes = (win as any).__graphBytes;
  if (graphBytes) {
    const store = (win as any).__graphSettingsToml as Record<string, unknown>;
    const source = (win as any).__graphSource;
    backend.graphSource = graphBytes;
    backend.graphLayout = source.layout;
    backend.onGraphLayout = (bytes) => {
      source.layout = bytes;
      source.saves++;
    };
    backend.vaultTables.graph = Object.fromEntries(
      Object.entries(store).map(([k, v]) => [k.replace(/^graph\./, ""), v]),
    );
    backend.onVaultTable = (id, table) => {
      if (id !== "graph") {
        return;
      }
      for (const k of Object.keys(store)) {
        delete store[k];
      }
      for (const [k, v] of Object.entries(table)) {
        store[`graph.${k}`] = v;
      }
      (win as any).__graphPersist?.();
    };
  }
  setPluginsBackend(backend);
  updatePreferences(
    {
      pluginsEnabled:
        params.get("enabled") === "none" ? [] : on.map((p) => p.id),
      // ?bar=off hides the activity bar (memory attribution)
      ...(params.get("bar") === "off" ? { activityBar: false } : {}),
    },
    win,
  );
  // The activity bar entries the official plugins declare (main.tsx gets them from bootPlugins).
  (await import("../src/plugins/boot")).syncOfficialActivity(win);
  const host = await startPluginHost(win, (run) => win.setTimeout(run, 0));
  (win as any).__plugins = {
    host,
    /** The fake backend: `folders.sourcePick` seeds what the next folder dialog returns. */
    backend,
    ensureActive,
    getPluginCosts,
    getPluginLog,
    getStubRegistrationMs,
    hasCommand: (id: string) => registeredCommands().some((c) => c.id === id),
  };
  (win as any).__pluginsReady = true;
}
