import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { boot, type TestPlugin } from "../testing";

import { getPluginLog, resetErrors } from "./errors";

import type { PluginContext } from "../api";

let t: TestPlugin | undefined;
beforeEach(() => {
  resetErrors();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  await t?.dispose();
  t = undefined;
  vi.restoreAllMocks();
});

const run = async (api: number, activate: (ctx: PluginContext) => void) => {
  t = await boot(
    { id: "lvl", api, activation: ["onStartupFinished"] },
    { activate },
  );
  return getPluginLog("lvl").map((l) => `${l.level}: ${l.text}`);
};

describe("API level of a plugin", () => {
  it("api = 1 loads without a deprecation line", async () => {
    expect(await run(1, () => {})).toEqual([]);
  });

  it("api = 0 still loads and warns once in the plugin log", async () => {
    let seen = false;
    const log = await run(0, () => {
      seen = true;
    });
    expect(seen).toBe(true);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatch(/^warn: deprecated: plugin\.toml says api = 0/);
  });
});

describe("deprecated toast option `action`", () => {
  it("still shows the button and warns once", async () => {
    const log = await run(1, (ctx) => {
      ctx.ui.toast("a", { action: { label: "Go", run: () => {} } });
      ctx.ui.toast("b", { action: { label: "Go", run: () => {} } });
      ctx.ui.toast("c", { actions: [{ label: "Go", run: () => {} }] });
    });
    expect(log).toEqual([
      "warn: deprecated: ui.toast option `action` is replaced by `actions` and goes in API 2.0",
    ]);
  });
});
