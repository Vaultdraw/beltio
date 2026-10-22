import { act, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sceneListenerCount } from "../../sceneOps/sceneBus";
import { boot, type TestPlugin } from "../testing";

import { pluginErrorCount } from "./errors";

import type { Plugin, PluginContext } from "../api";

let t: TestPlugin | undefined;
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  await t?.dispose();
  t = undefined;
  vi.restoreAllMocks();
});

/** Boots a plugin whose activate hands its ctx to the test. */
const bootCtx = async (extra: Plugin["activate"] = () => {}) => {
  let ctx!: PluginContext;
  t = await boot(
    {
      id: "sc",
      contributes: {
        commands: [{ id: "go" }],
        panels: [{ id: "p" }],
      },
    },
    {
      activate(c) {
        ctx = c;
        return extra(c);
      },
    },
  );
  await t.run("go").catch(() => {});
  return ctx;
};

const rect = { type: "rectangle", width: 10, height: 10 } as const;

describe("ctx.scene.elements", () => {
  it("is a frozen snapshot decoupled from the live elements", async () => {
    const ctx = await bootCtx((c) => void c.commands.register("go", () => {}));
    t!.scene.setElements([{ ...rect, id: "a", x: 5 }]);
    const snap = ctx.scene.elements();
    expect(snap).toHaveLength(1);
    expect(Object.isFrozen(snap)).toBe(true);
    expect(snap[0]).toMatchObject({ id: "a", type: "rectangle", x: 5 });
    expect(snap[0]).not.toHaveProperty("version");
    (t!.scene.live()[0] as { x: number }).x = 99; // in-place drag
    expect(snap[0].x).toBe(5);
    t!.scene.emitChange();
    expect(ctx.scene.elements()[0].x).toBe(99);
  });

  it("is [] with no drawing open", async () => {
    const ctx = await bootCtx((c) => void c.commands.register("go", () => {}));
    t!.scene.setElements([rect]);
    t!.scene.switchTo(null);
    expect(ctx.scene.elements()).toEqual([]);
  });
});

describe("ctx.scene.onChange", () => {
  it("delivers edit and switch, guarded and attributed, and disposes on disable", async () => {
    const calls: unknown[] = [];
    const base = sceneListenerCount();
    await bootCtx((c) => {
      c.commands.register("go", () => {});
      c.scene.onChange((e) => {
        calls.push(e);
        throw new Error("boom");
      });
    });
    expect(sceneListenerCount()).toBe(base + 1);
    t!.scene.setElements([{ ...rect, id: "a" }]);
    await t!.flush();
    expect(calls).toEqual([{ reason: "edit", path: "fake.excalidraw" }]);
    expect(pluginErrorCount("sc")).toBe(1);
    t!.scene.switchTo("other.excalidraw");
    await t!.flush();
    expect(calls.at(-1)).toEqual({
      reason: "switch",
      path: "other.excalidraw",
    });
    await t!.disable();
    expect(sceneListenerCount()).toBe(base);
    t!.scene.emitChange();
    await t!.flush();
    expect(calls).toHaveLength(2);
  });

  it("a plugin that never subscribes leaves no scene listener", async () => {
    const base = sceneListenerCount();
    await bootCtx((c) => void c.commands.register("go", () => {}));
    expect(sceneListenerCount()).toBe(base);
  });
});

describe("ctx.scene.batch", () => {
  const add = [{ op: "add", element: rect }] as const;

  it("returns ids and commits one scene update", async () => {
    const ctx = await bootCtx((c) => void c.commands.register("go", () => {}));
    const { ids } = await ctx.scene.batch([...add, ...add]);
    expect(ids).toHaveLength(2);
    expect(t!.scene.batches).toHaveLength(1);
    expect(t!.scene.live().map((e) => e.id)).toEqual(ids);
  });

  it("validation errors are logged against the plugin and rethrown", async () => {
    const ctx = await bootCtx((c) => void c.commands.register("go", () => {}));
    await expect(
      ctx.scene.batch([{ op: "delete", id: "missing" }]),
    ).rejects.toThrow();
    expect(t!.scene.batches).toHaveLength(0);
    expect(t!.log().some((l) => l.text.startsWith("scene.batch"))).toBe(true);
  });

  it("rejects when read-only", async () => {
    const ctx = await bootCtx((c) => void c.commands.register("go", () => {}));
    t!.scene.readOnly(true);
    await expect(ctx.scene.batch(add)).rejects.toThrow(/read-only/);
    expect(t!.scene.batches).toHaveLength(0);
  });

  it("rejects with no drawing (or during a swap)", async () => {
    const ctx = await bootCtx((c) => void c.commands.register("go", () => {}));
    t!.scene.switchTo(null);
    await expect(ctx.scene.batch(add)).rejects.toThrow(/no drawing/);
  });

  it("viewportCenter reads the active viewport", async () => {
    const ctx = await bootCtx((c) => void c.commands.register("go", () => {}));
    expect(ctx.scene.viewportCenter()).toEqual({ x: 400, y: 300 });
    t!.scene.switchTo(null);
    expect(ctx.scene.viewportCenter()).toEqual({ x: 0, y: 0 });
  });
});

describe("ctx.scene.useScene", () => {
  it("re-renders only when the selected value changes and unsubscribes on unmount", async () => {
    const renders = vi.fn();
    const base = sceneListenerCount();
    t = await boot(
      { id: "us", contributes: { panels: [{ id: "p" }] } },
      {
        activate(ctx) {
          const Panel = () => {
            const n = ctx.scene.useScene((els) => els.length);
            renders(n);
            return <div data-testid="count">{n}</div>;
          };
          ctx.panels.register("p", Panel);
        },
      },
    );
    t.scene.setElements([{ ...rect, id: "a" }]);
    const view = await t.openPanel("p");
    expect(screen.getByTestId("count").textContent).toBe("1");
    expect(sceneListenerCount()).toBe(base + 1);
    const before = renders.mock.calls.length;

    t.scene.emitChange(); // edit, same count
    await t.flush();
    expect(renders.mock.calls.length).toBe(before);

    t.scene.setElements([
      { ...rect, id: "a" },
      { ...rect, id: "b" },
    ]);
    await t.flush();
    expect(screen.getByTestId("count").textContent).toBe("2");

    view.unmount();
    await act(async () => {});
    expect(sceneListenerCount()).toBe(base);
  });
});
