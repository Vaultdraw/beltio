import { afterEach, describe, expect, it } from "vitest";

import { findImporter, runImports } from "../importerMap";
import { getRegisteredHandler } from "../../commands/handlerRegistry";
import { updatePreferences } from "../../vault/preferences";

import { ensureActive } from "./activation";
import { createGateway } from "./gateway";
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

  it("importers: stub registration of 50 plugins with 2 importers each", async () => {
    const withImporters = (infos: PluginInfo[]) =>
      infos.map((info, i) => ({
        ...info,
        contributes: {
          ...info.contributes,
          importers: [
            { id: "a", title: "A", extensions: [`a${i}`, `aa${i}`] },
            { id: "b", title: "B", extensions: [`b${i}`] },
          ],
        },
      }));
    const measure = async (infos: PluginInfo[]) => {
      setupHost(infos, {});
      const host = await startPluginHost(window, (run) => run());
      updatePreferences({ pluginsEnabled: infos.map((i) => i.id) });
      const ms = getStubRegistrationMs();
      updatePreferences({ pluginsEnabled: [] });
      await tick();
      host.stop();
      return ms;
    };
    const base = many(50);
    // Median of 5 runs each, alternating, to keep noise out of the comparison.
    const plain: number[] = [];
    const withI: number[] = [];
    for (let i = 0; i < 5; i++) {
      plain.push(await measure(base));
      withI.push(await measure(withImporters(base)));
    }
    const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[2];
    console.info(
      `stub registration, 50 plugins: ${med(plain).toFixed(
        2,
      )} ms without importers, ${med(withI).toFixed(
        2,
      )} ms with 2 importers each`,
    );
    expect(med(withI)).toBeLessThan(5);
    // claimImporter re-resolves every extension on each claim, so the cost grows with the
    // number of claims; the relative cost is reported above and bounded here in absolute terms.
  });

  it("drop to import() call with an active plugin, and host overhead per vault call", async () => {
    const info = makePluginInfo("bench-imp", {
      permissions: ["vault.read"],
      contributes: {
        commands: [],
        panels: [],
        settings: [],
        importers: [{ id: "txt", title: "T", extensions: ["txt"] }],
      },
    });
    const h = setupHost([info], {});
    let called = 0;
    const { setModuleLoader } = await import("./loader");
    setModuleLoader(async () => ({
      default: {
        activate: (ctx: import("../api").PluginContext) => {
          ctx.importers.register("txt", { import: () => void called++ });
        },
      },
    }));
    const host = await startPluginHost(window, (run) => run());
    stop = host.stop;
    updatePreferences({ pluginsEnabled: ["bench-imp"] });
    await tick();
    await ensureActive("bench-imp");
    const file = new File(["hello"], "a.txt");
    const target = { path: "fake.excalidraw", at: { x: 0, y: 0 } };
    const match = findImporter("a.txt")!;
    for (let i = 0; i < 50; i++) {
      await runImports([{ file, match }], target);
    }
    const n = 500;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      await runImports([{ file, match }], target);
    }
    const perImport = (performance.now() - t0) / n;
    console.info(
      `runImports to import() call, active plugin: ${perImport.toFixed(3)} ms`,
    );
    expect(called).toBe(n + 50);
    expect(perImport).toBeLessThan(2);

    // Host overhead of one vault call: wrapper (permission, path check, projection) minus the fake backend itself.
    h.backend.drawings["a.excalidraw"] = {
      scene: { type: "excalidraw", elements: [] },
      revision: "r",
    };
    const { createVaultApi } = await import("./vaultContext");
    const { getRuntime } = await import("./activation");
    const api = createVaultApi(getRuntime("bench-imp")!);
    const raw = createGateway("bench-imp");
    const per = async (fn: () => Promise<unknown>, count = 5000) => {
      for (let i = 0; i < 500; i++) {
        await fn();
      }
      const t = performance.now();
      for (let i = 0; i < count; i++) {
        await fn();
      }
      return (performance.now() - t) / count;
    };
    const wrapped = await per(() => api.readDrawing("a.excalidraw"));
    const direct = await per(() => raw("file.read", { path: "a.excalidraw" }));
    console.info(
      `vault.readDrawing host overhead: ${((wrapped - direct) * 1000).toFixed(
        1,
      )} us (wrapped ${(wrapped * 1000).toFixed(1)} us, bare gateway ${(
        direct * 1000
      ).toFixed(1)} us)`,
    );
    expect(wrapped - direct).toBeLessThan(0.1);
  });
});
