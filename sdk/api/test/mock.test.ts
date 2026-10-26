import { afterEach, describe, expect, it, vi } from "vitest";

import { boot, type TestPlugin } from "../testing";

import type { Plugin, PluginContext } from "../src/index";

let p: TestPlugin | undefined;

afterEach(async () => {
  await p?.dispose();
  p = undefined;
  vi.useRealTimers();
});

const commands = (...ids: string[]) => ({
  commands: ids.map((id) => ({ id })),
});

/** A plugin whose one command runs `fn` with the context. */
const withCommand = (fn: (ctx: PluginContext) => unknown): Plugin => ({
  activate(ctx) {
    ctx.commands.register("go", () => fn(ctx) as void);
  },
});

describe("mock host: activation", () => {
  it("is lazy, happens once, and starts at startup when asked", async () => {
    const activate = vi.fn((ctx: PluginContext) => {
      ctx.commands.register("go", () => {});
    });
    p = await boot({ id: "a", contributes: commands("go") }, { activate });
    expect(activate).not.toHaveBeenCalled();
    await p.run("go");
    await p.run("go");
    expect(activate).toHaveBeenCalledTimes(1);

    const early = vi.fn();
    await p.dispose();
    p = await boot(
      { id: "b", activation: ["onStartupFinished"] },
      { activate: early },
    );
    expect(early).toHaveBeenCalledTimes(1);
  });

  it("refuses a command that is not declared, as the app does", async () => {
    p = await boot(
      { id: "a", contributes: commands("go") },
      {
        activate(ctx) {
          ctx.commands.register("go", () => {});
          const d = ctx.commands.register("sneaky", () => {});
          expect(() => d.dispose()).not.toThrow();
        },
      },
    );
    await p.run("go");
    expect(p.log()).toEqual([
      {
        level: "error",
        text: 'register: command "sneaky" is not declared in plugin.toml',
      },
    ]);
    await expect(p.run("sneaky")).rejects.toThrow(
      'no command "a.sneaky" (declared in the manifest?)',
    );
  });

  it("refuses a panel that is not declared", async () => {
    p = await boot(
      { id: "a", contributes: commands("go") },
      {
        activate(ctx) {
          ctx.commands.register("go", () => {});
          ctx.panels.register("nope", () => null);
        },
      },
    );
    await p.run("go");
    expect(p.log()[0].text).toBe(
      'register: panel "nope" is not declared in plugin.toml',
    );
  });

  it("disable calls deactivate once and removes the commands", async () => {
    const deactivate = vi.fn();
    p = await boot(
      { id: "a", contributes: commands("go") },
      {
        activate(ctx) {
          ctx.commands.register("go", () => {});
        },
        deactivate,
      },
    );
    await p.run("go");
    await p.disable();
    expect(deactivate).toHaveBeenCalledTimes(1);
    await expect(p.run("go")).rejects.toThrow(/no command "a.go"/);
  });
});

describe("mock host: toasts", () => {
  it("prefixes the plugin name and de-duplicates identical toasts", async () => {
    p = await boot(
      { id: "a", name: "Alpha", contributes: commands("go") },
      withCommand((ctx) => {
        ctx.ui.toast("hi");
        ctx.ui.toast("hi");
        ctx.ui.toast("other");
      }),
    );
    await p.run("go");
    expect(p.toasts()).toEqual(["Alpha: hi", "Alpha: other"]);
  });

  it("shows at most three, the newest", async () => {
    p = await boot(
      { id: "a", name: "A", contributes: commands("go") },
      withCommand((ctx) => {
        for (const n of [1, 2, 3, 4]) {
          ctx.ui.toast(String(n));
        }
      }),
    );
    await p.run("go");
    expect(p.toasts()).toEqual(["A: 2", "A: 3", "A: 4"]);
  });

  it("toasts and logs a failing command; run does not reject", async () => {
    p = await boot(
      { id: "a", name: "A", contributes: commands("go") },
      withCommand(() => {
        throw new Error("boom");
      }),
    );
    await p.run("go");
    expect(p.toasts()).toEqual(["A: command go failed: boom"]);
    expect(p.log()).toEqual([{ level: "error", text: "command go: boom" }]);
  });

  it("switches the plugin off after three errors", async () => {
    p = await boot(
      { id: "a", name: "A", contributes: commands("go") },
      withCommand(() => {
        throw new Error("boom");
      }),
    );
    await p.run("go");
    await p.run("go");
    await p.run("go");
    expect(p.toasts().at(-1)).toMatch(/^Plugin A was disabled: 3 errors/);
    await expect(p.run("go")).rejects.toThrow(/no command/);
  });
});

describe("mock host: settings", () => {
  const settings = [
    { key: "n", type: "int" as const, title: "N", default: 5, min: 1, max: 10 },
    { key: "c", type: "color" as const, title: "C", default: "#ffffff" },
  ];

  it("rejects values outside the bounds and keeps the default", async () => {
    let seen: unknown[] = [];
    p = await boot(
      { id: "a", contributes: { commands: [{ id: "go" }], settings } },
      withCommand((ctx) => {
        seen = [ctx.settings.get("n"), ctx.settings.get("c")];
      }),
    );
    expect(await p.setSetting("n", 11)).toBe(false);
    expect(await p.setSetting("n", 2.5)).toBe(false);
    expect(await p.setSetting("c", "red")).toBe(false);
    expect(await p.setSetting("n", 7)).toBe(true);
    expect(await p.setSetting("n", 3, "vault")).toBe(false);
    await p.run("go");
    expect(seen).toEqual([7, "#ffffff"]);
  });

  it("settings.set rejects an invalid value with the app's message", async () => {
    p = await boot(
      { id: "a", contributes: { commands: [{ id: "go" }], settings } },
      withCommand((ctx) => ctx.settings.set("n", 99)),
    );
    await p.run("go");
    expect(p.log()[0].text).toBe(
      'command go: Setting "n" refused: invalid value or scope',
    );
  });

  it("calls onChange only when the effective value changes", async () => {
    const seen: unknown[] = [];
    p = await boot(
      { id: "a", contributes: { commands: [{ id: "go" }], settings } },
      withCommand((ctx) => {
        ctx.settings.onChange("n", (v) => seen.push(v));
      }),
    );
    await p.run("go");
    await p.setSetting("n", 5); // the default: no change
    await p.setSetting("n", 6);
    await p.setSetting("n", 99); // refused
    await p.setSetting("n", 6);
    expect(seen).toEqual([6]);
  });

  it("warns and registers nothing for an invalid declaration", async () => {
    p = await boot(
      {
        id: "a",
        contributes: {
          settings: [
            { key: "n", type: "int", title: "N", default: "x" as never },
          ],
        },
      },
      { activate() {} },
    );
    expect(p.log()[0]).toEqual({
      level: "warn",
      text: 'Invalid setting "n" of a: n: default must be a whole number',
    });
  });
});

describe("mock host: timers and disposal", () => {
  it("counts timers and clears them on disable", async () => {
    vi.useFakeTimers();
    const ticks = vi.fn();
    p = await boot(
      { id: "a", contributes: commands("go") },
      withCommand((ctx) => {
        ctx.setInterval(ticks, 100);
        ctx.setTimeout(ticks, 1000);
      }),
    );
    await p.run("go");
    expect(p.timers()).toBe(2);
    await vi.advanceTimersByTimeAsync(250);
    expect(ticks).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(p.timers()).toBe(1); // the timeout fired, the interval runs
    await p.disable();
    expect(p.timers()).toBe(0);
    ticks.mockClear();
    await vi.advanceTimersByTimeAsync(1000);
    expect(ticks).not.toHaveBeenCalled();
  });

  it("disposes subscriptions in reverse order and attributes errors to the log", async () => {
    const order: string[] = [];
    p = await boot(
      { id: "a", contributes: commands("go") },
      withCommand((ctx) => {
        for (const n of ["first", "second", "third"]) {
          ctx.subscriptions.push({
            dispose() {
              order.push(n);
              if (n === "second") {
                throw new Error("bad dispose");
              }
            },
          });
        }
      }),
    );
    await p.run("go");
    await expect(p.disable()).resolves.toBeUndefined();
    expect(order).toEqual(["third", "second", "first"]);
    expect(p.log()).toContainEqual({
      level: "error",
      text: "dispose: bad dispose",
    });
  });

  it("dispose() leaves nothing for the next test", async () => {
    const decl = { key: "n", type: "int" as const, title: "N", default: 1 };
    const manifest = {
      id: "a",
      name: "A",
      contributes: { commands: [{ id: "go" }], settings: [decl] },
    };
    const plugin = withCommand((ctx) => {
      ctx.ui.toast(`n=${ctx.settings.get("n")}`);
      ctx.setInterval(() => {}, 1000);
    });
    p = await boot(manifest, plugin);
    await p.setSetting("n", 9);
    await p.run("go");
    expect(p.toasts()).toEqual(["A: n=9"]);
    await p.dispose();
    expect(p.timers()).toBe(0);
    expect(p.toasts()).toEqual([]);

    p = await boot(manifest, plugin);
    expect(p.toasts()).toEqual([]);
    await p.run("go");
    expect(p.toasts()).toEqual(["A: n=1"]);
  });
});

describe("mock host: events and scene", () => {
  it("delivers app events asynchronously, and not after disable", async () => {
    const seen: string[] = [];
    p = await boot(
      { id: "a", activation: ["onStartupFinished"] },
      {
        activate(ctx) {
          ctx.events.on("drawing.saved", (e) => seen.push(e.path));
          ctx.events.on("nope" as never, () => {});
        },
      },
    );
    p.events.emit("drawing.saved", { path: "a.excalidraw" });
    expect(seen).toEqual([]);
    await p.flush();
    expect(seen).toEqual(["a.excalidraw"]);
    expect(p.log()[0].text).toBe('events.on: unknown event "nope"');
    await p.disable();
    p.events.emit("drawing.saved", { path: "b.excalidraw" });
    await p.flush();
    expect(seen).toEqual(["a.excalidraw"]);
  });

  it("scene.batch refuses invalid ops with the app's wording and writes nothing", async () => {
    let error = "";
    p = await boot(
      { id: "a", contributes: commands("go") },
      withCommand(async (ctx) => {
        try {
          await ctx.scene.batch([
            { op: "add", element: { type: "rectangle", width: 0 } },
            { op: "delete", id: "missing" },
          ]);
        } catch (err) {
          error = (err as Error).message;
        }
      }),
    );
    await p.run("go");
    expect(error).toBe(
      "op 0 (width): must be a finite number in 1..1000000; op 1 (id): no such element",
    );
    expect(p.scene.batches).toHaveLength(0);
    expect(p.log()[0].text).toBe(`scene.batch: ${error}`);
  });

  it("scene.batch and createDrawing use plugins.scene_max_ops like the app", async () => {
    const rects = (n: number) =>
      Array.from({ length: n }, () => ({
        op: "add" as const,
        element: { type: "rectangle" as const, width: 10, height: 10 },
      }));
    const run = async (n: number, sceneMaxOps?: number) => {
      const out: string[] = [];
      await p?.dispose();
      p = await boot(
        { id: "a", permissions: ["vault.write"], contributes: commands("go") },
        withCommand(async (ctx) => {
          for (const call of [
            () => ctx.scene.batch(rects(n)),
            () => ctx.vault.createDrawing(`n${n}.excalidraw`, rects(n)),
          ]) {
            out.push(
              await call().then(
                () => "ok",
                (e: Error) => e.message,
              ),
            );
          }
        }),
        { sceneMaxOps },
      );
      await p.run("go");
      return out;
    };
    const tooMany = (max: number) =>
      `op -1: at most ${max} ops per batch (plugins.scene_max_ops)`;
    expect(await run(500)).toEqual(["ok", "ok"]);
    expect(await run(501)).toEqual([tooMany(500), tooMany(500)]);
    expect(await run(501, 1000)).toEqual(["ok", "ok"]);
    expect(await run(3, 2)).toEqual([tooMany(2), tooMany(2)]);
    expect(await run(501, 5000)).toEqual([tooMany(500), tooMany(500)]);
  });

  it("scene.batch writes one batch and the plugin reads it back", async () => {
    let ids: string[] = [];
    let seen = 0;
    p = await boot(
      { id: "a", contributes: commands("go") },
      withCommand(async (ctx) => {
        ids = (
          await ctx.scene.batch([
            {
              op: "add",
              element: { type: "rectangle", x: 0, y: 0, text: "Hi" },
            },
          ])
        ).ids;
        seen = ctx.scene.elements().length;
      }),
    );
    await p.run("go");
    expect(p.scene.batches).toHaveLength(1);
    expect(ids).toHaveLength(1);
    expect(seen).toBe(2); // the box and its label
  });

  it("scene.batch adds images (hashed, stored once) and refuses what passes the cap", async () => {
    const PNG = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1,
    ]);
    const pic = (bytes = PNG) =>
      ({
        op: "add",
        element: {
          type: "image",
          width: 10,
          height: 10,
          image: { mime: "image/png", bytes },
        },
      } as const);
    let tooLarge = "";
    let invalid = "";
    p = await boot(
      { id: "a", contributes: commands("go") },
      withCommand(async (ctx) => {
        await ctx.scene.batch([pic(), pic()]);
        try {
          await ctx.scene.batch([pic(new Uint8Array(9))]);
        } catch (err) {
          invalid = (err as { code: string }).code;
        }
        try {
          await ctx.scene.batch(
            Array.from({ length: 11 }, (_, i) => {
              const b = new Uint8Array(3 * 1024 * 1024);
              b.set(PNG);
              b[10] = i;
              return pic(b);
            }),
          );
        } catch (err) {
          tooLarge = (err as { code: string }).code;
        }
      }),
    );
    await p.run("go");
    expect(Object.keys(p.scene.files())).toHaveLength(1);
    expect(p.scene.live()).toHaveLength(2);
    expect(invalid).toBe("INVALID_ARGUMENT");
    expect(tooLarge).toBe("TOO_LARGE");
    expect(p.scene.batches).toHaveLength(1);
  });

  it("onChange fires once per frame and on a drawing switch", async () => {
    const seen: string[] = [];
    p = await boot(
      { id: "a", contributes: commands("go") },
      withCommand((ctx) => {
        ctx.scene.onChange((e) => seen.push(`${e.reason}:${e.path}`));
      }),
    );
    await p.run("go");
    p.scene.setElements([{ type: "rectangle", x: 0, y: 0 }]);
    p.scene.emitChange();
    await p.flush();
    p.scene.switchTo("b.excalidraw");
    expect(seen).toEqual(["edit:fake.excalidraw", "switch:b.excalidraw"]);
  });
});

describe("mock host: not set up", () => {
  it("executing another plugin's command fails loudly", async () => {
    p = await boot(
      { id: "a", contributes: commands("go") },
      withCommand((ctx) => ctx.commands.execute("app.save")),
    );
    await p.run("go");
    expect(p.log()[0].text).toMatch(
      /^command go: not set up in this test: command "app.save"/,
    );
  });

  it("useScene without a panel fails loudly", async () => {
    p = await boot(
      { id: "a", contributes: commands("go") },
      withCommand((ctx) => ctx.scene.useScene((e) => e.length)),
    );
    await p.run("go");
    expect(p.log()[0].text).toMatch(/not set up in this test: scene.useScene/);
  });

  it("opening an undeclared panel names the command", async () => {
    p = await boot({ id: "a" }, { activate() {} });
    await expect(p.openPanel("x")).rejects.toThrow(
      'no command "a.panel.x" (declared in the manifest?)',
    );
  });
});

describe("mock host: speed", () => {
  it("boots a small plugin fast (soft check: warns only)", async () => {
    const t0 = performance.now();
    p = await boot(
      { id: "a", contributes: commands("go") },
      withCommand(() => {}),
    );
    await p.run("go");
    const ms = performance.now() - t0;
    if (ms > 50) {
      // eslint-disable-next-line no-console
      console.warn(
        `mock host: boot + first run took ${ms.toFixed(1)} ms (> 50)`,
      );
    }
    expect(ms).toBeGreaterThanOrEqual(0);
  });
});
