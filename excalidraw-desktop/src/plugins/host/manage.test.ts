import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getRegisteredCommand } from "../../commands/registry";
import { toastStore } from "../../toasts/toastStore";
import { getPreferences, updatePreferences } from "../../vault/preferences";

import { disablePlugin, getRuntime } from "./activation";
import { setModuleLoader } from "./loader";
import { makePluginInfo } from "./fakeBackend";
import { getPluginLog } from "./errors";
import {
  clearHostDisabled,
  getPluginsState,
  installPluginFolder,
  pickPluginFolder,
  reloadPlugin,
  rescanPlugins,
  restartInSafeMode,
  stopDevListener,
  subscribePluginsState,
  uninstallPlugin,
  RELOAD_HINT_EVERY,
} from "./manage";
import { LAUNCH_OK_DELAY_MS, startPluginHost } from "./start";
import {
  enable,
  registrySizes,
  setupHost,
  tick,
  withCommands,
} from "./testUtils";

import type { Plugin } from "../api";

let stop: (() => void) | undefined;
beforeEach(() => {
  localStorage.clear();
  toastStore.clear();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  vi.useRealTimers();
  enable([]);
  await tick();
  stop?.();
  stop = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const plugin = (): Plugin => ({
  activate: (ctx) => {
    ctx.commands.register("go", () => {});
  },
});

const boot = async (
  infos: Parameters<typeof setupHost>[0],
  mods: Parameters<typeof setupHost>[1] = {},
) => {
  const h = setupHost(infos, mods);
  const host = await startPluginHost(window, (run) => run());
  stop = host.stop;
  return h;
};

describe("rescan", () => {
  it("adds new plugins and disposes removed ones", async () => {
    const a = withCommands("alpha", "go");
    const b = withCommands("beta", "go");
    const h = await boot([a], { alpha: plugin(), beta: plugin() });
    enable(["alpha", "beta"]);
    const base = registrySizes().commands;
    expect(getRegisteredCommand("beta.go")).toBeUndefined();
    h.backend.plugins = [a, b];
    await rescanPlugins();
    expect(getRegisteredCommand("beta.go")).toBeDefined();
    expect(registrySizes().commands).toBe(base + 1);
    h.backend.plugins = [b];
    await rescanPlugins();
    expect(getRegisteredCommand("alpha.go")).toBeUndefined();
    expect(getPluginsState().plugins.map((p) => p.id)).toEqual(["beta"]);
  });

  it("publishes a stable, subscribable snapshot with runtime states", async () => {
    await boot([withCommands("alpha", "go")], { alpha: plugin() });
    const seen = vi.fn();
    const off = subscribePluginsState(seen);
    const first = getPluginsState();
    expect(getPluginsState()).toBe(first);
    expect(first.runtime.alpha).toEqual({ state: "idle", enabled: false });
    enable(["alpha"]);
    expect(seen).toHaveBeenCalled();
    expect(getPluginsState().runtime.alpha.enabled).toBe(true);
    off();
  });
});

describe("reload", () => {
  it("re-imports once with ?t and keeps registries at baseline", async () => {
    await boot([withCommands("alpha", "go")], { alpha: plugin() });
    const urls: string[] = [];
    setModuleLoader(async (url) => {
      urls.push(url);
      return { default: plugin() };
    });
    enable(["alpha"]);
    await tick();
    const { ensureActive } = await import("./index");
    await ensureActive("alpha");
    const base = registrySizes("alpha.go");
    expect(urls).toHaveLength(1);
    await reloadPlugin("alpha");
    expect(urls).toHaveLength(2);
    expect(getRuntime("alpha")?.state).toBe("active");
    expect(registrySizes("alpha.go")).toEqual(base);
    expect(urls.at(-1)).toMatch(/\?t=1$/);
  });

  it("does not activate a plugin that was idle", async () => {
    const h = await boot([withCommands("alpha", "go")], { alpha: plugin() });
    enable(["alpha"]);
    await tick();
    await reloadPlugin("alpha");
    expect(h.loads).toEqual([]);
    expect(getRegisteredCommand("alpha.go")).toBeDefined();
  });

  it("hints to restart after many reloads", async () => {
    await boot([withCommands("alpha", "go")], { alpha: plugin() });
    enable(["alpha"]);
    for (let i = 0; i < RELOAD_HINT_EVERY; i++) {
      await reloadPlugin("alpha");
    }
    expect(
      getPluginLog("alpha").some((l) => /restart to free memory/.test(l.text)),
    ).toBe(true);
  });

  it("a dev change event reloads the plugin", async () => {
    const dev = makePluginInfo("alpha", { dev: true });
    const h = await boot([dev], { alpha: plugin() });
    enable(["alpha"]);
    await tick();
    const { ensureActive } = await import("./index");
    await ensureActive("alpha");
    h.backend.emitChanged("alpha");
    await vi.waitFor(() => expect(h.loads).toEqual(["alpha", "alpha"]));
  });

  it("a dev plugin that crashed is not saved as disabled and restarts on the next save", async () => {
    let bad = true;
    const dev = withCommands("alpha", "go");
    dev.dev = true;
    const h = await boot([dev], {
      alpha: () => ({
        activate(ctx) {
          ctx.commands.register("go", () => {
            if (bad) {
              throw new Error("typo");
            }
          });
        },
      }),
    });
    enable(["alpha"]);
    // The listener belongs to the backend of the first dev test: attach ours.
    await stopDevListener();
    await rescanPlugins();
    const { ensureActive } = await import("./index");
    const { getRegisteredHandler } = await import(
      "../../commands/handlerRegistry"
    );
    await ensureActive("alpha");
    const run = getRegisteredHandler("alpha.go")!;
    for (let i = 0; i < 3; i++) {
      await run();
    }
    expect(getRuntime("alpha")?.state).toBe("disabled");
    expect(h.backend.hostDisabledCalls).toHaveLength(0);
    expect(
      toastStore
        .getSnapshot()
        .toasts.map((t) => t.message)
        .join(),
    ).toMatch(/stopped.*Save a file/);

    bad = false;
    h.backend.emitChanged("alpha");
    await tick();
    await tick();
    expect(getRuntime("alpha")?.state).toBe("active");
    const { pluginErrorCount } = await import("./errors");
    expect(pluginErrorCount("alpha")).toBe(0);
    // Two more errors after the reload do not stop it (the count restarted).
    bad = true;
    const run2 = getRegisteredHandler("alpha.go")!;
    await run2();
    await run2();
    expect(getRuntime("alpha")?.state).toBe("active");
  });

  it("installs no dev listener when no plugin is dev", async () => {
    const h = await boot([makePluginInfo("alpha")], { alpha: plugin() });
    const spy = vi.spyOn(h.backend, "onChanged");
    await rescanPlugins();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("open plugins folder", () => {
  it("the command opens the plugins folder itself", async () => {
    const h = await boot([]);
    const { PLUGIN_UI_COMMAND_IDS, pluginUiHandlers } = await import(
      "../ui/pluginCommands"
    );
    pluginUiHandlers(() => {})[PLUGIN_UI_COMMAND_IDS.openFolder]?.();
    await vi.waitFor(() => expect(h.backend.opened).toEqual([null]));
  });
});

describe("install, uninstall, host-disabled", () => {
  it("installs without enabling", async () => {
    const h = await boot([]);
    h.backend.installable["/src/new"] = makePluginInfo("fresh");
    const info = await installPluginFolder("/src/new");
    expect(info.id).toBe("fresh");
    expect(getPluginsState().runtime.fresh.enabled).toBe(false);
  });

  it("uninstall disposes, removes from enabled and rescans", async () => {
    await boot([withCommands("alpha", "go"), withCommands("beta", "go")], {
      alpha: plugin(),
      beta: plugin(),
    });
    enable(["alpha", "beta"]);
    await uninstallPlugin("alpha");
    expect(getPreferences().pluginsEnabled).toEqual(["beta"]);
    expect(getRegisteredCommand("alpha.go")).toBeUndefined();
    expect(getPluginsState().plugins.map((p) => p.id)).toEqual(["beta"]);
  });

  it("clearHostDisabled re-registers the plugin", async () => {
    const h = await boot([withCommands("alpha", "go")], { alpha: plugin() });
    h.backend.plugins = [
      { ...withCommands("alpha", "go"), hostDisabled: "3 errors" },
    ];
    enable(["alpha"]);
    await rescanPlugins();
    expect(getRegisteredCommand("alpha.go")).toBeUndefined();
    await clearHostDisabled("alpha");
    expect(h.backend.hostDisabledCalls.at(-1)).toEqual({
      id: "alpha",
      reason: null,
    });
    expect(getRegisteredCommand("alpha.go")).toBeDefined();
  });
});

describe("a plugin the host disabled after errors", () => {
  it("shows its reason in the snapshot at once, without a rescan", async () => {
    await boot([withCommands("alpha", "go")], { alpha: plugin() });
    enable(["alpha"]);
    await rescanPlugins();
    const first = subscribePluginsState(() => {});
    expect(getPluginsState().plugins[0].hostDisabled).toBeNull();
    first(); // the page closes: nothing listens while the plugin fails
    disablePlugin("alpha", "3 errors");
    const unsubscribe = subscribePluginsState(() => {}); // and opens again
    expect(getPluginsState().plugins[0].hostDisabled).toBe("3 errors");
    expect(getPluginsState().runtime.alpha.state).toBe("disabled");
    await clearHostDisabled("alpha");
    expect(getPluginsState().plugins[0].hostDisabled).toBeNull();
    unsubscribe();
  });
});

describe("backend passthrough", () => {
  it("picks a folder and restarts in safe mode", async () => {
    const h = await boot([]);
    h.backend.pickResult = "/chosen";
    expect(await pickPluginFolder()).toBe("/chosen");
    await restartInSafeMode();
    expect(h.backend.restarts).toEqual(["safe"]);
  });
});

describe("safe mode", () => {
  const safe = {
    reason: "crashes" as const,
    crashedLaunches: 2,
    pluginsAtCrash: ["alpha"],
  };

  it("registers no stubs and loads nothing, but lists plugins", async () => {
    const h = setupHost([withCommands("alpha", "go")], { alpha: plugin() });
    h.backend.safeMode = safe;
    updatePreferences({ pluginsEnabled: ["alpha"] });
    const host = await startPluginHost(window, (run) => run());
    stop = host.stop;
    await host.startupDone;
    expect(getRegisteredCommand("alpha.go")).toBeUndefined();
    expect(h.loads).toEqual([]);
    expect(getPluginsState().safeMode).toEqual(safe);
    expect(getPluginsState().plugins).toHaveLength(1);
    expect(getRegisteredCommand("plugins.restartNormally")).toBeDefined();
    expect(getRegisteredCommand("plugins.restartSafeMode")).toBeUndefined();
    await rescanPlugins();
    expect(getRegisteredCommand("alpha.go")).toBeUndefined();
  });

  // toimprove #103: the Option key at launch (or "Restart in safe mode") must not take away the
  // app's own plugins (graph, gallery, ...): only the plugins the user added are off.
  it.each([
    ["modifier", "plugins", true],
    ["user", "plugins", true],
    ["crashes", "plugins", false],
    ["flag", "core", false],
  ] as const)(
    "safe mode %s (%s): official plugins stay on = %s; user plugins stay off",
    async (reason, scope, officialOn) => {
      const official = {
        ...withCommands("graph", "open"),
        source: "bundled" as const,
      };
      setupHost([official, withCommands("alpha", "go")], {
        graph: plugin(),
        alpha: plugin(),
      }).backend.safeMode = {
        reason,
        scope,
        crashedLaunches: 0,
        pluginsAtCrash: [],
      };
      updatePreferences({ pluginsEnabled: ["graph", "alpha"] });
      const host = await startPluginHost(window, (run) => run());
      stop = host.stop;
      await host.startupDone;
      expect(getRegisteredCommand("graph.open") !== undefined).toBe(officialOn);
      expect(getRegisteredCommand("alpha.go")).toBeUndefined();
    },
  );

  it("normal launch offers Restart in safe mode", async () => {
    await boot([]);
    const def = getRegisteredCommand("plugins.restartSafeMode");
    expect(def?.category).toBe("Plugins");
    stop?.();
    expect(getRegisteredCommand("plugins.restartSafeMode")).toBeUndefined();
  });
});

describe("launch ok", () => {
  it("is sent about 10 s after the host started, not before", async () => {
    vi.useFakeTimers();
    const h = setupHost([], {});
    const host = await startPluginHost(window, (run) => run());
    stop = host.stop;
    vi.advanceTimersByTime(LAUNCH_OK_DELAY_MS - 1);
    expect(h.backend.launchOkCalls).toBe(0);
    vi.advanceTimersByTime(1);
    expect(h.backend.launchOkCalls).toBe(1);
  });

  it("stop cancels it", async () => {
    vi.useFakeTimers();
    const h = setupHost([], {});
    const host = await startPluginHost(window, (run) => run());
    host.stop();
    vi.advanceTimersByTime(LAUNCH_OK_DELAY_MS * 2);
    expect(h.backend.launchOkCalls).toBe(0);
  });
});
