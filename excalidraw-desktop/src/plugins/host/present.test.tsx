import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readCustomContextKey } from "../../commands/contextKeys";
import {
  getLayoutState,
  resetLayoutState,
  setActivePreset,
} from "../../layout/layoutStore";
import { boot, type TestPlugin } from "../testing";

import type { Plugin, PluginContext } from "../api";

let t: TestPlugin | undefined;
beforeEach(() => {
  localStorage.clear();
  resetLayoutState();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  await t?.dispose();
  t = undefined;
  resetLayoutState();
  vi.restoreAllMocks();
});

const bootCtx = async (extra: Plugin["activate"] = () => {}) => {
  let ctx!: PluginContext;
  t = await boot(
    { id: "pr", contributes: { commands: [{ id: "go" }] } },
    {
      activate(c) {
        ctx = c;
        c.commands.register("go", () => {});
        return extra(c);
      },
    },
  );
  await t.run("go");
  return ctx;
};

const frame = {
  type: "frame",
  id: "f",
  x: 10,
  y: 20,
  width: 300,
  height: 200,
} as const;

describe("ctx.present", () => {
  it("rejects with no drawing, then runs a read-only focus-mode session and puts everything back", async () => {
    const ctx = await bootCtx();
    t!.scene.setElements([frame]);
    t!.scene.updateAppState({ viewBackgroundColor: "#ffffff" });
    let ended = 0;
    const s = await ctx.present.start({
      background: "#000000",
      fullscreen: false,
      onEnd: () => ended++,
    });
    expect(ctx.present.active).toBe(true);
    expect(readCustomContextKey("present.active")).toBe(true);
    expect(getLayoutState().preset).toBe("focus");
    const during = t!.scene.appState();
    expect(during).toMatchObject({
      viewModeEnabled: true,
      viewBackgroundColor: "#000000",
    });
    expect(during.frameRendering).toMatchObject({
      name: false,
      outline: false,
    });
    s.end();
    s.end();
    expect(ended).toBe(1);
    expect(s.isActive).toBe(false);
    expect(ctx.present.active).toBe(false);
    expect(readCustomContextKey("present.active")).toBe(false);
    expect(getLayoutState().preset).toBeNull();
    expect(t!.scene.appState()).toMatchObject({
      viewModeEnabled: false,
      viewBackgroundColor: "#ffffff",
      frameRendering: { name: true, outline: true },
    });
    t!.scene.switchTo(null);
    await expect(ctx.present.start()).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("the laser switches the editor tool and back", async () => {
    const ctx = await bootCtx();
    t!.scene.setElements([frame]);
    const s = await ctx.present.start({ fullscreen: false });
    s.setLaser(true);
    expect(s.laser).toBe(true);
    expect(t!.scene.appState().activeTool).toEqual({ type: "laser" });
    s.setLaser(false);
    expect(s.laser).toBe(false);
    s.end();
  });

  it("leaving focus mode (Escape) ends it; a second start ends the first", async () => {
    const ctx = await bootCtx();
    t!.scene.setElements([frame]);
    let first = 0;
    await ctx.present.start({ fullscreen: false, onEnd: () => first++ });
    setActivePreset(null);
    expect(first).toBe(1);
    expect(ctx.present.active).toBe(false);
    const a = await ctx.present.start({
      fullscreen: false,
      onEnd: () => first++,
    });
    const b = await ctx.present.start({ fullscreen: false });
    expect(first).toBe(2);
    expect(a.isActive).toBe(false);
    expect(b.isActive).toBe(true);
    b.end();
  });

  it("another drawing ending the session, and the plugin stopping", async () => {
    const ctx = await bootCtx();
    t!.scene.setElements([frame]);
    const s = await ctx.present.start({ fullscreen: false });
    t!.scene.switchTo("other.excalidraw");
    await Promise.resolve();
    await Promise.resolve();
    expect(s.isActive).toBe(false);
    t!.scene.switchTo("fake.excalidraw");
    const again = await ctx.present.start({ fullscreen: false });
    await t!.disable();
    expect(again.isActive).toBe(false);
  });
});

describe("ctx.scene.fitTo and frame names", () => {
  it("fits to a frame (selecting on request), ignores unknown ids", async () => {
    const ctx = await bootCtx();
    t!.scene.setElements([frame]);
    ctx.scene.fitTo("f", { padding: 30, select: true, animate: false });
    ctx.scene.fitTo("nope");
    expect(t!.scene.fittedTo()).toEqual([
      { id: "f", padding: 30, select: true, animate: false },
    ]);
  });

  it("a frame's name reads back; empty resets; other elements refuse it", async () => {
    const ctx = await bootCtx();
    t!.scene.setElements([
      { ...frame, name: "Intro" },
      { type: "rectangle", id: "r", width: 5, height: 5 },
    ]);
    expect(ctx.scene.elements().find((e) => e.id === "f")?.name).toBe("Intro");
    await ctx.scene.batch([{ op: "update", id: "f", props: { name: "Plan" } }]);
    expect(ctx.scene.elements().find((e) => e.id === "f")?.name).toBe("Plan");
    await ctx.scene.batch([{ op: "update", id: "f", props: { name: "" } }]);
    expect(
      ctx.scene.elements().find((e) => e.id === "f")?.name,
    ).toBeUndefined();
    await expect(
      ctx.scene.batch([{ op: "update", id: "r", props: { name: "x" } }]),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(
      ctx.scene.batch([
        { op: "update", id: "f", props: { name: "x".repeat(201) } },
      ]),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });
});
