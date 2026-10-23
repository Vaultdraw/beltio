import { act, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { boot, type TestPlugin } from "@vaultdraw/api/testing";

import { readExample } from "../testing/readManifest";

import plugin from "./main.js";

const ID = "focus-timer";
const remaining = () => screen.getByRole("timer").textContent;
let p: TestPlugin | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});
afterEach(async () => {
  await p?.dispose();
  p = undefined;
  vi.useRealTimers();
});

const start = async () => {
  const activate = vi.spyOn(plugin, "activate");
  p = await boot(readExample(ID), plugin);
  return activate;
};

describe("focus-timer", () => {
  it("declares the commands, the hotkey and the panel; loads no code until used", async () => {
    const activate = await start();
    const { commands, panels } = p!.info.contributes;
    expect(commands.map((c) => c.id)).toEqual(["start", "stop"]);
    expect(commands[0].keys).toEqual(["Mod+Alt+Shift+T"]);
    expect(panels.map((x) => x.id)).toEqual(["timer"]);
    expect(activate).not.toHaveBeenCalled();
    expect(p!.timers()).toBe(0);
  });

  it("start activates once and toasts after `minutes`", async () => {
    const activate = await start();
    await p!.setSetting("minutes", 2);
    await p!.run("start");
    await p!.run("start");
    expect(activate).toHaveBeenCalledTimes(1);
    // Restarting replaced the first timeout: still exactly one.
    expect(p!.timers()).toBe(1);

    await vi.advanceTimersByTimeAsync(119_000);
    expect(p!.toasts()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(p!.toasts()).toEqual(["Focus timer: Focus session done"]);
    expect(p!.timers()).toBe(0);
  });

  it("panel interval exists only while the panel is mounted and a session runs", async () => {
    await start();
    const view = await p!.openPanel("timer");
    expect(p!.timers()).toBe(0);
    await act(async () =>
      screen.getByRole("button", { name: "Start" }).click(),
    );
    // The end timeout plus the panel's one-second tick.
    expect(p!.timers()).toBe(2);
    expect(remaining()).toBe("25:00");

    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(remaining()).toBe("24:57");

    view.unmount();
    expect(p!.timers()).toBe(1);
  });

  it("buttons start and stop; idle with the panel open holds no timer", async () => {
    await start();
    await p!.openPanel("timer");
    expect(remaining()).toBe("25:00");
    expect(p!.timers()).toBe(0);

    await act(async () =>
      screen.getByRole("button", { name: "Start" }).click(),
    );
    expect(p!.timers()).toBe(2);
    expect(screen.getByRole("button", { name: "Restart" })).toBeTruthy();

    await act(async () => screen.getByRole("button", { name: "Stop" }).click());
    expect(p!.timers()).toBe(0);
    expect(remaining()).toBe("25:00");
  });

  it("stop clears the session and its timeout", async () => {
    await start();
    await p!.run("start");
    expect(p!.timers()).toBe(1);
    await p!.run("stop");
    expect(p!.timers()).toBe(0);
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(p!.toasts()).toEqual([]);
  });

  it("costs nothing once disabled", async () => {
    await start();
    await p!.openPanel("timer");
    await act(async () =>
      screen.getByRole("button", { name: "Start" }).click(),
    );
    expect(p!.timers()).toBe(2);
    await p!.disable();
    await expect(p!.run("start")).rejects.toThrow(/no command/);
    expect(p!.timers()).toBe(0);
  });
});
