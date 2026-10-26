import { afterEach, describe, expect, it, vi } from "vitest";

import { getRegisteredCommand } from "../commands/registry";
import { toastStore } from "../toasts/toastStore";

import {
  listenSafeStartRequests,
  onSafeStartRequested,
  registerSafeStartCommands,
  SAFE_REQUESTED_EVENT,
} from "./commands";
import { setSafeStart } from "./state";

import type { SafeStart } from "./state";

const invoke = vi.fn<(cmd: string) => Promise<undefined>>(
  async () => undefined,
);
vi.mock("@tauri-apps/api/core", () => ({ invoke: (c: string) => invoke(c) }));

const safe = (scope: SafeStart["scope"]): SafeStart => ({
  reason: "flag",
  scope,
  crashedLaunches: 0,
  pluginsAtCrash: [],
});

afterEach(() => {
  setSafeStart(null);
  toastStore.clear();
  invoke.mockClear();
});

describe("safe start commands", () => {
  it("offers only 'restart in safe start' in a normal start, in the App category with no key", () => {
    const off = registerSafeStartCommands();
    const c = getRegisteredCommand("app.restartSafe");
    expect(c?.title).toBe("Restart in safe start (core only)");
    expect(c?.category).toBe("App");
    expect(c?.keys.default).toEqual([]);
    expect(getRegisteredCommand("app.restartNormally")).toBeUndefined();
    off();
    expect(getRegisteredCommand("app.restartSafe")).toBeUndefined();
  });

  it("swaps to 'restart normally' in a core safe start and back", () => {
    const off = registerSafeStartCommands();
    setSafeStart(safe("core"));
    expect(getRegisteredCommand("app.restartSafe")).toBeUndefined();
    expect(getRegisteredCommand("app.restartNormally")?.title).toBe(
      "Restart normally",
    );
    // Plugin safe mode keeps P2b's own "Restart normally"; core safe start is offered.
    setSafeStart(safe("plugins"));
    expect(getRegisteredCommand("app.restartNormally")).toBeUndefined();
    expect(getRegisteredCommand("app.restartSafe")).toBeDefined();
    setSafeStart(null);
    expect(getRegisteredCommand("app.restartSafe")).toBeDefined();
    expect(getRegisteredCommand("app.restartNormally")).toBeUndefined();
    off();
  });

  it("a second launch asking for safe start shows a toast with a restart action", async () => {
    onSafeStartRequested();
    const t = toastStore.getSnapshot().toasts[0];
    expect(t.action?.label).toBe("Restart in safe start");
    t.action?.run();
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("app_restart_safe"),
    );
  });

  it("says so instead of offering a restart when already in core safe start", () => {
    setSafeStart(safe("core"));
    onSafeStartRequested();
    const t = toastStore.getSnapshot().toasts[0];
    expect(t.message).toMatch(/already/);
    expect(t.action).toBeUndefined();
  });

  it("listens for the launch event and survives a missing Tauri", async () => {
    const listen = vi.fn(async () => () => {});
    await listenSafeStartRequests(listen);
    expect(listen).toHaveBeenCalledWith(
      SAFE_REQUESTED_EVENT,
      onSafeStartRequested,
    );
    const off = await listenSafeStartRequests(async () => {
      throw new Error("no tauri");
    });
    expect(() => off()).not.toThrow();
  });
});
