import { beforeEach, describe, expect, it, vi } from "vitest";

import { setPluginsList } from "../plugins/host/pluginsState";

import { createPluginMethods } from "./pluginMethods";

const plugin = (id: string, enabled: boolean) => ({
  id,
  name: id.toUpperCase(),
  version: "1.0.0",
  contributes: {
    commands: [{ id: "go", title: "Go", keys: [], when: [], palette: true }],
  },
  enabled,
});

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
});
