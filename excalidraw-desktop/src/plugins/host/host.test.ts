import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getRegisteredHandler } from "../../commands/handlerRegistry";
import { getCommand } from "../../commands/commands";
import { getPluginSetting } from "../settings/pluginSettings";
import { toastStore } from "../../toasts/toastStore";
import { updatePreferences } from "../../vault/preferences";

import { ensureActive, getRuntime } from "./activation";
import { getPluginCosts } from "./cost";
import {
  attributeByStack,
  getPluginProblems,
  pluginErrorCount,
} from "./errors";
import { makePluginInfo } from "./fakeBackend";
import { guard } from "./guard";

import { queueStartupActivations, startPluginHost } from "./start";
import {
  enable,
  registrySizes,
  setupHost,
  tick,
  withCommands,
} from "./testUtils";

import { syncPlugins } from "./index";

import type { Plugin, PluginContext } from "../api";

const toasts = () => toastStore.getSnapshot().toasts.map((t) => t.message);
let stop: (() => void) | undefined;

beforeEach(() => {
  localStorage.clear();
  toastStore.clear();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  enable([]);
  await tick();
  stop?.();
  stop = undefined;
  vi.restoreAllMocks();
});

const boot = async (
  infos: Parameters<typeof setupHost>[0],
  mods: Parameters<typeof setupHost>[1],
) => {
  const h = setupHost(infos, mods);
  const host = await startPluginHost(window, (run) => run());
  stop = host.stop;
  return { ...h, host };
};

describe("stubs", () => {
  it("register for enabled plugins only, with full ids", async () => {
    const hello = withCommands("hello", "say");
    hello.contributes.commands[0].keys = ["Mod+Alt+H"];
    hello.contributes.commands[0].when = ["vaultOpen"];
    const off = withCommands("off", "x");
    const incompat = { ...withCommands("old", "x"), compatible: false };
    const hd = { ...withCommands("bad", "x"), hostDisabled: "crashed" };
    await boot([hello, off, incompat, hd], {});
    enable(["hello", "old", "bad"]);
    const def = getCommand("hello.say");
    expect(def?.category).toBe("hello");
    expect(def?.keys.default).toEqual(["Mod+Alt+H"]);
    expect(def?.when).toEqual(["vaultOpen"]);
    expect(getCommand("off.x")).toBeUndefined();
    expect(getCommand("old.x")).toBeUndefined();
    expect(getCommand("bad.x")).toBeUndefined();
    expect(getRegisteredHandler("off.x")).toBeUndefined();
    expect(getRuntime("hello")?.state).toBe("idle");
  });

  it("invalid declared settings become a problem, not a throw", async () => {
    const info = makePluginInfo("sett");
    info.contributes.settings = [
      { key: "n", type: "int", title: "N", default: "x" } as never,
    ];
    await boot([info], {});
    enable(["sett"]);
    expect(getPluginProblems("sett")).toHaveLength(1);
    expect(registrySizes().settings).toBe(0);
  });
});

describe("activation", () => {
  it("activates once for 3 concurrent triggers and replays each", async () => {
    const run = vi.fn();
    const activate = vi.fn((ctx: PluginContext) => {
      ctx.commands.register("say", run);
    });
    const { loads } = await boot([withCommands("hello", "say")], {
      hello: { activate },
    });
    enable(["hello"]);
    const h = getRegisteredHandler("hello.say")!;
    await Promise.all([h(), h(), h()]);
    expect(activate).toHaveBeenCalledTimes(1);
    expect(loads).toEqual(["hello"]);
    expect(run).toHaveBeenCalledTimes(3);
    expect(getRuntime("hello")?.state).toBe("active");
    h();
    expect(run).toHaveBeenCalledTimes(4);
  });

  it("refuses undeclared command registration (attributed)", async () => {
    await boot([withCommands("hello", "say")], {
      hello: {
        activate: (ctx) => void ctx.commands.register("nope", () => {}),
      },
    });
    enable(["hello"]);
    await ensureActive("hello");
    expect(pluginErrorCount("hello")).toBe(1);
    expect(getRegisteredHandler("hello.nope")).toBeUndefined();
  });

  it("declared but unregistered command: attributed error and toast", async () => {
    await boot([withCommands("hello", "say")], { hello: { activate() {} } });
    enable(["hello"]);
    await getRegisteredHandler("hello.say")!();
    expect(pluginErrorCount("hello")).toBe(1);
    expect(toasts().join()).toMatch(/declared but not registered/);
  });

  it("failed activation disables the plugin, no retry", async () => {
    const { backend, loads } = await boot([withCommands("hello", "say")], {
      hello: {
        activate() {
          throw new Error("boom");
        },
      },
    });
    enable(["hello"]);
    await getRegisteredHandler("hello.say")!();
    expect(backend.hostDisabledCalls[0].id).toBe("hello");
    expect(toasts().join()).toMatch(/Hello|hello was disabled/);
    expect(getCommand("hello.say")).toBeUndefined();
    expect(await ensureActive("hello")).toBe(false);
    expect(loads).toHaveLength(1);
    // a config change must not bring it back
    enable(["hello", "x"]);
    expect(getCommand("hello.say")).toBeUndefined();
  });

  it("a module without activate fails activation", async () => {
    await boot([withCommands("hello", "say")], { hello: {} as Plugin });
    enable(["hello"]);
    expect(await ensureActive("hello")).toBe(false);
    expect(getRuntime("hello")?.state).toBe("disabled");
  });

  it("3 attributed errors host-disable the plugin", async () => {
    const { backend } = await boot([withCommands("hello", "say")], {
      hello: {
        activate(ctx) {
          ctx.commands.register("say", () => {
            throw new Error("bad");
          });
        },
      },
    });
    enable(["hello"]);
    const h = getRegisteredHandler("hello.say")!;
    await h();
    expect(toasts().join()).toMatch(/command say failed: bad/);
    await h();
    expect(backend.hostDisabledCalls).toHaveLength(0);
    await h();
    expect(backend.hostDisabledCalls).toHaveLength(1);
    expect(toasts().join()).toMatch(/was disabled/);
    expect(getRuntime("hello")?.state).toBe("disabled");
  });
});

describe("disable and re-enable", () => {
  it("returns every registry to baseline and reuses the module", async () => {
    const info = withCommands("full", "go");
    info.contributes.panels = [
      { id: "p", title: "P", icon: null, group: "top" },
    ];
    info.contributes.settings = [
      { key: "greeting", type: "string", title: "G", default: "Hi" },
    ];
    const deactivated = vi.fn();
    const { loads } = await boot([info], {
      full: {
        activate(ctx) {
          ctx.commands.register("go", () => {});
          ctx.setInterval(() => {}, 1000);
          ctx.setTimeout(() => {}, 100000);
        },
        deactivate: deactivated,
      },
    });
    const base = registrySizes("full.go");
    enable(["full"]);
    expect(registrySizes("full.go").commands).toBe(base.commands + 2);
    expect(registrySizes().top).toBe(base.top + 1);
    expect(registrySizes().settings).toBe(base.settings + 1);
    await getRegisteredHandler("full.go")!();
    expect(registrySizes().timers).toBe(base.timers + 2);

    enable([]);
    await tick();
    expect(registrySizes("full.go")).toEqual(base);
    expect(deactivated).toHaveBeenCalledTimes(1);

    enable(["full"]);
    await getRegisteredHandler("full.go")!();
    expect(loads).toEqual(["full"]);
    expect(getRuntime("full")?.state).toBe("active");
    enable([]);
    await tick();
    expect(registrySizes("full.go")).toEqual(base);
  });

  it("deactivate has a 2 s timeout", async () => {
    vi.useFakeTimers();
    try {
      const { host } = await (async () => {
        const h = setupHost([withCommands("slow", "x")], {
          slow: { activate() {}, deactivate: () => new Promise(() => {}) },
        });
        const host = await startPluginHost(window, (run) => run());
        stop = host.stop;
        return { ...h, host };
      })();
      void host;
      enable(["slow"]);
      await ensureActive("slow");
      enable([]);
      await vi.advanceTimersByTimeAsync(1900);
      expect(getRuntime("slow")?.disposeContext).toBeNull();
      expect(getRuntime("slow")?.state).toBe("idle");
      await vi.advanceTimersByTimeAsync(200);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("guard and attribution", () => {
  it("attributes sync and async errors", async () => {
    setupHost([], {});
    guard("p1", () => {
      throw new Error("sync");
    })();
    await guard("p1", async () => {
      throw new Error("async");
    })();
    expect(pluginErrorCount("p1")).toBe(2);
    expect(guard("p1", () => 5)()).toBe(5);
  });

  it("finds the plugin in a stack", () => {
    const e = (u: string) => ({ stack: `Error\n  at f (${u}:1:2)` });
    expect(attributeByStack(e("vdplugin://localhost/my-plug/main.js"))).toBe(
      "my-plug",
    );
    expect(
      attributeByStack(e("http://vdplugin.localhost/win-1/a/main.js")),
    ).toBe("win-1");
    expect(attributeByStack(e("http://localhost/app.js"))).toBeNull();
    expect(attributeByStack("x")).toBeNull();
  });
});

describe("settings api", () => {
  it("get, set and onChange", async () => {
    const info = makePluginInfo("cfg");
    info.contributes.settings = [
      { key: "greeting", type: "string", title: "G", default: "Hi" },
    ];
    let ctx!: PluginContext;
    await boot([info], { cfg: { activate: (c) => void (ctx = c) } });
    enable(["cfg"]);
    await ensureActive("cfg");
    const seen: unknown[] = [];
    ctx.settings.onChange("greeting", (v) => seen.push(v));
    expect(ctx.settings.get("greeting")).toBe("Hi");
    await ctx.settings.set("greeting", "Yo");
    expect(getPluginSetting("cfg", "greeting")).toBe("Yo");
    expect(seen).toEqual(["Yo"]);
    await expect(ctx.settings.set("greeting", 5)).rejects.toThrow();
  });
});

describe("startup activation", () => {
  it("activates onStartupFinished plugins one at a time", async () => {
    const order: string[] = [];
    const mk = (id: string): Plugin => ({
      activate: async () => {
        order.push(`${id}:start`);
        await tick();
        order.push(`${id}:end`);
      },
    });
    const a = makePluginInfo("a-p", { activation: ["onStartupFinished"] });
    const b = makePluginInfo("b-p", { activation: ["onStartupFinished"] });
    const c = makePluginInfo("c-p");
    const { host } = await boot([a, b, c], {
      "a-p": mk("a"),
      "b-p": mk("b"),
      "c-p": mk("c"),
    });
    enable(["a-p", "b-p", "c-p"]);
    await host.startupDone;
    expect(order).toEqual(["a:start", "a:end", "b:start", "b:end"]);
    expect(getRuntime("c-p")?.state).toBe("idle");
  });

  it("queue ignores plugins without the activation", async () => {
    setupHost([], {});
    await queueStartupActivations([makePluginInfo("z-p")], ["z-p"], (r) => r());
  });
});

describe("cost", () => {
  it("records load, activate, handlers and slow runs", async () => {
    await boot([withCommands("hello", "say")], {
      hello: { activate: (ctx) => void ctx.commands.register("say", () => {}) },
    });
    enable(["hello"]);
    await getRegisteredHandler("hello.say")!();
    const [c] = getPluginCosts();
    expect(c.loadMs).not.toBeNull();
    expect(c.activateMs).not.toBeNull();
    expect(c.handlerMs).toHaveLength(1);
    expect(c.registrations.commands).toBe(1);
    expect(c.estimatedBytes).toBe(6000);
    expect(
      performance.getEntriesByName("vaultdraw:plugin:hello:activate").length,
    ).toBeGreaterThan(0);
  });
});

describe("syncPlugins", () => {
  it("is a no-op for zero plugins", () => {
    setupHost([], {});
    expect(syncPlugins([], [])).toEqual({ started: [] });
    updatePreferences({ pluginsEnabled: [] });
  });
});
