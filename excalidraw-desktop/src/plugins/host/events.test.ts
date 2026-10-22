import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appEvents } from "../../events/appEvents";
import { boot, type TestPlugin } from "../testing";

import { pluginErrorCount } from "./errors";

import type { PluginContext } from "../api";

let t: TestPlugin | undefined;
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  await t?.dispose();
  t = undefined;
  vi.restoreAllMocks();
});

const bootEvents = async (activate: (ctx: PluginContext) => void) => {
  t = await boot({ id: "ev", activation: ["onStartupFinished"] }, { activate });
  return t;
};

describe("ctx.events", () => {
  it("delivers asynchronously, in order, once per emit", async () => {
    const seen: string[] = [];
    await bootEvents((ctx) => {
      ctx.events.on("drawing.saved", (p) => seen.push(`saved:${p.path}`));
      ctx.events.on("drawing.renamed", (p) => seen.push(`${p.from}>${p.to}`));
    });
    t!.events.emit("drawing.saved", { path: "a" });
    t!.events.emit("drawing.renamed", { from: "a", to: "b" });
    t!.events.emit("drawing.saved", { path: "b" });
    expect(seen).toEqual([]);
    await t!.flush();
    expect(seen).toEqual(["saved:a", "a>b", "saved:b"]);
  });

  it("guards and attributes a throwing callback", async () => {
    const ok = vi.fn();
    await bootEvents((ctx) => {
      ctx.events.on("drawing.opened", () => {
        throw new Error("x");
      });
      ctx.events.on("drawing.opened", ok);
    });
    t!.events.emit("drawing.opened", { path: "a" });
    await t!.flush();
    expect(ok).toHaveBeenCalledWith({ path: "a" });
    expect(pluginErrorCount("ev")).toBe(1);
  });

  it("unknown name: attributed error and a no-op disposable", async () => {
    let d: { dispose(): void } | undefined;
    await bootEvents((ctx) => {
      d = ctx.events.on("nope" as never, () => {});
    });
    expect(pluginErrorCount("ev")).toBe(1);
    expect(() => d!.dispose()).not.toThrow();
  });

  it("disable removes every listener and drops queued events", async () => {
    const cb = vi.fn();
    await bootEvents((ctx) => void ctx.events.on("vault.opened", cb));
    expect(appEvents.hasListeners("vault.opened")).toBe(true);
    t!.events.emit("vault.opened", { name: "v" });
    await t!.disable();
    expect(appEvents.hasListeners("vault.opened")).toBe(false);
    await t!.flush();
    expect(cb).not.toHaveBeenCalled();
  });
});
