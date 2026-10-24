import { afterEach, describe, expect, it } from "vitest";

import { getRegisteredHandler } from "../../commands/handlerRegistry";
import { updatePreferences } from "../../vault/preferences";

import { ensureActive } from "./activation";
import { getStubRegistrationMs } from "./cost";
import { makePluginInfo } from "./fakeBackend";
import { startPluginHost } from "./start";
import { setupHost, tick } from "./testUtils";

import type { PluginInfo } from "./types";

const many = (n: number): PluginInfo[] =>
  Array.from({ length: n }, (_, i) => {
    const info = makePluginInfo(`bench-${i}`);
    info.contributes = {
      commands: [0, 1, 2].map((c) => ({
        id: `c${c}`,
        title: `Command ${c}`,
        keys: [],
        when: [],
        palette: true,
      })),
      panels: [{ id: "p", title: "Panel", icon: null, group: "top" }],
      settings: [0, 1, 2, 3].map((s) => ({
        key: `s${s}`,
        type: "int",
        title: `S${s}`,
        default: 1,
      })) as never,
    };
    return info;
  });

describe("plugin host micro-benchmark", () => {
  let stop: (() => void) | undefined;
  afterEach(async () => {
    updatePreferences({ pluginsEnabled: [] });
    await tick();
    stop?.();
  });

  it("stub registration of 50 plugins, host overhead per command call", async () => {
    const infos = many(50);
    setupHost(infos, {});
    const host = await startPluginHost(window, (run) => run());
    stop = host.stop;
    const ids = infos.map((i) => i.id);
    updatePreferences({ pluginsEnabled: ids });
    const regMs = getStubRegistrationMs();
    console.info(
      `stub registration, 50 plugins x (3 cmds, 1 panel, 4 settings): ${regMs.toFixed(
        2,
      )} ms`,
    );
    expect(regMs).toBeLessThan(5);

    // Overhead of a stub-resolved call on an active plugin vs a direct call.
    const direct = () => {};
    const { setModuleLoader } = await import("./loader");
    setModuleLoader(async () => ({
      default: {
        activate: (ctx: import("../api").PluginContext) =>
          void ctx.commands.register("c0", direct),
      },
    }));
    await ensureActive("bench-0");
    const stub = getRegisteredHandler("bench-0.c0")!;
    const per = (fn: () => unknown, n = 100_000) => {
      for (let i = 0; i < 2000; i++) {
        fn();
      }
      const t = performance.now();
      for (let i = 0; i < n; i++) {
        fn();
      }
      return (performance.now() - t) / n;
    };
    const overhead = per(stub) - per(direct);
    console.info(
      `stub-resolved call overhead: ${(overhead * 1000).toFixed(2)} us`,
    );
    expect(overhead).toBeLessThan(0.1);
  });

  it("ctx creation stays cheap: host and theme are built on first read only", async () => {
    const { createPluginContext } = await import("./context");
    const { ensureRuntime } = await import("./activation");
    setupHost([], {});
    const rt = ensureRuntime(makePluginInfo("bench-ctx"));
    const make = () => createPluginContext(rt, window).dispose();
    for (let i = 0; i < 500; i++) {
      make();
    }
    const n = 5000;
    const t = performance.now();
    for (let i = 0; i < n; i++) {
      make();
    }
    const perCtx = (performance.now() - t) / n;
    console.info(`ctx creation: ${(perCtx * 1000).toFixed(1)} us`);
    expect(perCtx).toBeLessThan(0.1);
  });
});
