import { beforeEach, describe, expect, it, vi } from "vitest";

import { setPluginsList } from "../plugins/host/pluginsState";

import { createPluginMethods } from "./pluginMethods";

const plugin = (id: string, enabled: boolean) => ({
  id,
  name: id.toUpperCase(),
  version: "1.0.0",
  permissions: ["control"],
  review: { state: "ok", added: [] },
  contributes: {
    commands: [{ id: "go", title: "Go", keys: [], when: [], palette: true }],
    methods: [
      { id: "echo", title: "Echo", mcp: true, write: false },
      { id: "secret", title: "Secret", mcp: false, write: true },
      { id: "slow", title: "Slow", mcp: true, write: false, timeout_ms: 100 },
      { id: "bad", title: "Bad", mcp: true, write: false },
      { id: "none", title: "None", mcp: true, write: false },
    ],
  },
  enabled,
});

const handlers = new Map<string, (p: unknown) => unknown>([
  ["echo", (p) => ({ got: p })],
  ["secret", () => "s"],
  ["slow", () => new Promise(() => {})],
  [
    "bad",
    () => {
      throw new Error("boom");
    },
  ],
  ["none", () => undefined],
]);
const ensureActive = vi.fn(async (_id: string) => true);
vi.mock("../plugins/host/activation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../plugins/host/activation")>()),
  ensureActive: (id: string) => ensureActive(id),
  getRuntime: () => ({ methods: handlers }),
}));

vi.mock("../vault/preferences", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../vault/preferences")>()),
  getPreferences: () => ({ pluginsEnabled: ["on"] } as never),
}));
vi.mock("../commands/commands", () => ({
  getCommand: (id: string) => (id === "on.go" ? { id } : undefined),
}));

const make = (run = true) => {
  const runner = {
    run: vi.fn(() => run),
    isAvailable: vi.fn(() => true),
    failedClauses: () => ["drawingOpen"],
  };
  return { m: createPluginMethods(() => runner), runner };
};

describe("plugin control methods", () => {
  beforeEach(() => {
    setPluginsList({
      plugins: [plugin("on", true), plugin("off", false)] as never,
      errors: [],
      scanMs: 0,
      safeMode: null,
    });
  });

  it("lists commands per plugin with the enabled flag", async () => {
    const { m } = make();
    const r = (await m["plugin.commands"]({})) as any;
    expect(r.plugins.map((p: any) => [p.id, p.enabled])).toEqual([
      ["on", true],
      ["off", false],
    ]);
    expect(r.plugins[0].commands[0].id).toBe("on.go");
    const one = (await m["plugin.commands"]({ plugin: "off" })) as any;
    expect(one.plugins).toHaveLength(1);
    await expect(m["plugin.commands"]({ plugin: "zz" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("runs an enabled plugin command and refuses the rest", async () => {
    const { m, runner } = make();
    expect(await m["plugin.run"]({ id: "on.go" })).toEqual({
      ran: true,
      id: "on.go",
      plugin: "on",
    });
    expect(runner.run).toHaveBeenCalledWith("on.go");
    await expect(m["plugin.run"]({ id: "off.go" })).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
    await expect(m["plugin.run"]({ id: "nope.x" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    // A core command is not a plugin command.
    await expect(
      m["plugin.run"]({ id: "vault.newDrawing" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("reports an unavailable command with the failed clauses", async () => {
    const { m } = make(false);
    await expect(m["plugin.run"]({ id: "on.go" })).rejects.toMatchObject({
      code: "UNAVAILABLE",
      data: { failed: ["drawingOpen"] },
    });
  });

  it("lists the methods of enabled plugins; an AI app sees only mcp ones", async () => {
    const { m } = make();
    const all = (await m["plugin.methods"]({})) as any;
    expect(all.methods.map((x: any) => `${x.plugin}.${x.method}`)).toEqual([
      "on.echo",
      "on.secret",
      "on.slow",
      "on.bad",
      "on.none",
    ]);
    const ai = (await m["plugin.methods"]({ by: "mcp" })) as any;
    expect(ai.methods.map((x: any) => x.method)).not.toContain("secret");
    expect(ai.methods[0]).toMatchObject({ plugin: "on", write: false });
  });

  it("calls a method: lazy activation, JSON in and out", async () => {
    const { m } = make();
    const r = await m["plugin.call"]({
      plugin: "on",
      method: "echo",
      params: { a: 1 },
    });
    expect(r).toEqual({
      plugin: "on",
      method: "echo",
      result: { got: { a: 1 } },
    });
    expect(ensureActive).toHaveBeenCalledWith("on");
    // No params means {}.
    expect(
      (await m["plugin.call"]({ plugin: "on", method: "echo" })) as any,
    ).toMatchObject({ result: { got: {} } });
  });

  it("refuses unknown, disabled and not-offered methods", async () => {
    const { m } = make();
    await expect(
      m["plugin.call"]({ plugin: "on", method: "zz" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      m["plugin.call"]({ plugin: "off", method: "echo" }),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
    // The command line may call it; an AI app is told it does not exist.
    await expect(
      m["plugin.call"]({ plugin: "on", method: "secret" }),
    ).resolves.toMatchObject({ result: "s" });
    await expect(
      m["plugin.call"]({ plugin: "on", method: "secret", by: "mcp" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("times out, reports a throw and refuses a result that is not JSON", async () => {
    const { m } = make();
    await expect(
      m["plugin.call"]({ plugin: "on", method: "slow" }),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
    await expect(
      m["plugin.call"]({ plugin: "on", method: "bad" }),
    ).rejects.toMatchObject({ code: "PLUGIN_ERROR" });
    await expect(
      m["plugin.call"]({ plugin: "on", method: "none" }),
    ).rejects.toMatchObject({ code: "PLUGIN_ERROR" });
  });
});
