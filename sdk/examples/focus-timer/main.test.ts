import { act, cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { activityBarRegistry } from "../../../excalidraw-desktop/src/activityBar/activityBarRegistry";
import { getCommand } from "../../../excalidraw-desktop/src/commands/commands";
import { getRegisteredHandler } from "../../../excalidraw-desktop/src/commands/handlerRegistry";
import { getRuntime } from "../../../excalidraw-desktop/src/plugins/host/activation";
import { pluginTimerCount } from "../../../excalidraw-desktop/src/plugins/host/context";
import { PluginPanels } from "../../../excalidraw-desktop/src/plugins/host/PluginPanels";
import { startPluginHost } from "../../../excalidraw-desktop/src/plugins/host/start";
import {
  enable,
  registrySizes,
  setupHost,
} from "../../../excalidraw-desktop/src/plugins/host/testUtils";
import { setPluginSetting } from "../../../excalidraw-desktop/src/plugins/settings/pluginSettings";
import {
  closePanel,
  isPanelOpen,
} from "../../../excalidraw-desktop/src/slots/panelStore";
import { toastStore } from "../../../excalidraw-desktop/src/toasts/toastStore";
import { readExample } from "../testing/readManifest";

import plugin from "./main.js";

const ID = "focus-timer";
const START = `${ID}.start`;
const STOP = `${ID}.stop`;
const PANEL = `${ID}.timer`;
const toasts = () => toastStore.getSnapshot().toasts.map((t) => t.message);
const run = (id: string) => getRegisteredHandler(id)!();
const remaining = () => screen.getByRole("timer").textContent;
/** Let promises and zero-delay timers settle under fake timers. */
const settle = () => act(() => vi.advanceTimersByTimeAsync(0));
let stop: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  toastStore.clear();
});
afterEach(async () => {
  cleanup();
  closePanel(PANEL);
  enable([]);
  await vi.advanceTimersByTimeAsync(0);
  stop?.();
  stop = undefined;
  vi.useRealTimers();
});

const boot = async () => {
  const activate = vi.spyOn(plugin, "activate");
  const h = setupHost([readExample(ID)], { [ID]: plugin });
  stop = (await startPluginHost(window, (fn) => fn())).stop;
  return { ...h, activate };
};

describe("focus-timer", () => {
  it("is not enabled: nothing registered, nothing loaded", async () => {
    const { loads } = await boot();
    expect(getCommand(START)).toBeUndefined();
    expect(getCommand(`${ID}.panel.timer`)).toBeUndefined();
    expect(
      activityBarRegistry.list("activityBar.top").map((e) => e.id),
    ).not.toContain(PANEL);
    expect(loads).toEqual([]);
  });

  it("registers stubs for the commands and the panel without loading code", async () => {
    const { loads, activate } = await boot();
    enable([ID]);
    expect(getCommand(START)?.keys.default).toEqual(["Mod+Alt+Shift+T"]);
    expect(getCommand(STOP)).toBeDefined();
    expect(getCommand(`${ID}.panel.timer`)?.title).toBe(
      "Toggle Focus timer panel",
    );
    expect(
      activityBarRegistry.list("activityBar.top").map((e) => e.id),
    ).toContain(PANEL);
    expect(getRuntime(ID)?.state).toBe("idle");
    expect(loads).toEqual([]);
    expect(activate).not.toHaveBeenCalled();
    expect(pluginTimerCount()).toBe(0);
  });

  it("start activates once, opens the panel, toasts after `minutes`", async () => {
    const { loads, activate } = await boot();
    enable([ID]);
    await setPluginSetting(ID, "minutes", 2, "global");
    await act(async () => {
      await run(START);
      await run(START);
    });
    expect(loads).toEqual([ID]);
    expect(activate).toHaveBeenCalledTimes(1);
    expect(isPanelOpen(PANEL)).toBe(true);
    // Restarting replaced the first timeout: still exactly one.
    expect(pluginTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(119_000);
    expect(toasts()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(toasts()).toEqual(["Focus timer: Focus session done"]);
    expect(pluginTimerCount()).toBe(0);
  });

  it("panel interval exists only while the panel is mounted and a session runs", async () => {
    await boot();
    enable([ID]);
    await act(async () => {
      await run(START);
    });
    // Panel was opened but nothing mounts it yet: only the end timeout.
    expect(pluginTimerCount()).toBe(1);

    render(createElement(PluginPanels));
    await settle();
    expect(remaining()).toBe("25:00");
    expect(pluginTimerCount()).toBe(2);

    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(remaining()).toBe("24:57");

    cleanup();
    expect(pluginTimerCount()).toBe(1);
  });

  it("buttons start and stop; idle with the panel open holds no timer", async () => {
    await boot();
    enable([ID]);
    await act(async () => {
      await run(`${ID}.panel.timer`);
    });
    render(createElement(PluginPanels));
    await settle();
    expect(remaining()).toBe("25:00");
    expect(pluginTimerCount()).toBe(0);

    const startButton = screen.getByRole("button", { name: "Start" });
    await act(async () => startButton.click());
    expect(pluginTimerCount()).toBe(2);
    expect(screen.getByRole("button", { name: "Restart" })).toBeTruthy();

    await act(async () => screen.getByRole("button", { name: "Stop" }).click());
    expect(pluginTimerCount()).toBe(0);
    expect(remaining()).toBe("25:00");
  });

  it("stop clears the session and its timeout", async () => {
    await boot();
    enable([ID]);
    await act(async () => {
      await run(START);
    });
    expect(pluginTimerCount()).toBe(1);
    await act(async () => {
      await run(STOP);
    });
    expect(pluginTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(toasts()).toEqual([]);
  });

  it("costs nothing once disabled", async () => {
    await boot();
    const base = registrySizes(START);
    enable([ID]);
    await act(async () => {
      await run(START);
    });
    render(createElement(PluginPanels));
    await settle();
    expect(pluginTimerCount()).toBe(2);
    cleanup();
    enable([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(registrySizes(START)).toEqual(base);
    expect(getCommand(START)).toBeUndefined();
    expect(pluginTimerCount()).toBe(0);
  });
});
