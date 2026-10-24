import { describe, expect, it, vi } from "vitest";

import { createControlBridge, type ControlDeps } from "./bridge";
import { createSnapshotSender } from "./commandsSnapshot";

const make = (over: Partial<ControlDeps> = {}, run = true, avail = true) => {
  const invoke = vi.fn().mockResolvedValue(undefined);
  const runner = {
    run: vi.fn(() => run),
    isAvailable: vi.fn(() => avail),
    failedClauses: vi.fn(() => ["drawingOpen"]),
    platform: "mac" as const,
  };
  const bridge = createControlBridge({
    listen: vi.fn(),
    invoke,
    runner: () => runner,
    overrides: () => ({}),
    appState: () => ({
      activeDrawing: { path: "a.excalidraw", dirty: false },
      tabs: 2,
    }),
    openTarget: async () => true,
    ...over,
  });
  const reply = async (method: string, params: unknown = {}) => {
    await bridge.handle({ rid: 7, method, params });
    return invoke.mock.calls.at(-1)![1] as Record<string, any>;
  };
  return { reply, runner, invoke, bridge };
};

describe("control bridge", () => {
  it("routes scene.* to the injected handlers, with no files dep", async () => {
    const apply = vi.fn(() => ({ applied: 1 }));
    const { reply } = make({ scene: { "scene.apply": apply } });
    expect(await reply("scene.apply", { ops: [] })).toEqual({
      rid: 7,
      result: { applied: 1 },
    });
    expect(apply).toHaveBeenCalledWith({ ops: [] });
  });

  it("registers the four lazy scene methods by default", async () => {
    // No drawing is open in this test: the real handlers answer NOT_FOUND no_drawing.
    const { reply } = make();
    for (const m of ["scene.read", "scene.get", "scene.selection"]) {
      const r = await reply(m, { ids: ["a"] });
      expect(r.error).toMatchObject({
        code: "NOT_FOUND",
        data: { reason: "no_drawing" },
      });
    }
    const r = await reply("scene.apply", {
      ops: [{ op: "delete", id: "a" }],
    });
    expect(r.error.data).toEqual({ reason: "no_drawing" });
  });

  it("runs a known command", async () => {
    const { reply, runner } = make();
    expect(await reply("command.run", { id: "file.save" })).toEqual({
      rid: 7,
      result: { ran: true, id: "file.save" },
    });
    expect(runner.run).toHaveBeenCalledWith("file.save");
  });

  it("reports failed clauses when unavailable", async () => {
    const { reply } = make({}, false);
    const r = await reply("command.run", { id: "file.save" });
    expect(r.error).toMatchObject({
      code: "UNAVAILABLE",
      data: { id: "file.save", failed: ["drawingOpen"] },
    });
  });

  it("unknown id is NOT_FOUND, prefix commands are known", async () => {
    const { reply } = make();
    expect((await reply("command.run", { id: "nope.x" })).error.code).toBe(
      "NOT_FOUND",
    );
    expect(
      (await reply("command.run", { id: "drawing.open:a.excalidraw" })).result
        .ran,
    ).toBe(true);
  });

  it("validates params", async () => {
    const { reply } = make();
    expect((await reply("command.run", {})).error.code).toBe("INVALID_PARAMS");
  });

  it("answers app.state and command.list", async () => {
    const { reply } = make();
    expect((await reply("app.state")).result.tabs).toBe(2);
    const list = (await reply("command.list")).result.commands;
    const save = list.find((c: any) => c.id === "file.save");
    expect(save).toMatchObject({
      available: true,
      keys: expect.arrayContaining(["Mod+S"]),
    });
    expect(list.some((c: any) => c.id === "cli.install")).toBe(true);
  });

  it("openTarget NOT_FOUND when unresolved", async () => {
    const { reply } = make({ openTarget: async () => false });
    expect(
      (await reply("app.openTarget", { target: "x", cwd: "/" })).error.code,
    ).toBe("NOT_FOUND");
  });

  it("unknown method", async () => {
    const { reply } = make();
    expect((await reply("zzz")).error).toMatchObject({
      code: "NOT_FOUND",
      message: "Unknown window method",
    });
  });

  it("start registers listener then control_ready", async () => {
    const order: string[] = [];
    const { bridge } = make({
      listen: vi.fn(async () => {
        order.push("listen");
        return () => {};
      }),
      invoke: vi.fn(async (c: string) => void order.push(c)),
    });
    await bridge.start();
    expect(order).toEqual(["listen", "control_ready"]);
  });
});

describe("snapshot sender", () => {
  it("skips unchanged lists", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const s = createSnapshotSender(send);
    const c = [{ id: "a", title: "A", category: "File", keys: [], when: [] }];
    expect(await s(c)).toBe(true);
    expect(await s([...c])).toBe(false);
    expect(await s([{ ...c[0], keys: ["F2"] }])).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
