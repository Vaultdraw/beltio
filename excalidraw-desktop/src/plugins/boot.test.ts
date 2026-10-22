import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getAppCommandRunner,
  setAppCommandRunner,
} from "../commands/appRunner";

import { updatePreferences } from "../vault/preferences";

import { runCommandById } from "./host/runner";

import { bootPlugins } from "./boot";
import { pluginHostStarted } from "./hostFlag";

const startPluginHost = vi.fn(async () => ({}));
vi.mock("./host/start", () => ({
  startPluginHost: (...a: unknown[]) => (startPluginHost as any)(...a),
}));

const fakeWin = (idle: boolean) => {
  const queue: (() => void)[] = [];
  const win = {
    localStorage: window.localStorage,
    setTimeout: (fn: () => void) => void queue.push(fn),
    ...(idle
      ? { requestIdleCallback: (fn: () => void) => void queue.push(fn) }
      : {}),
  } as unknown as Window;
  return { win, flush: () => queue.splice(0).forEach((f) => f()), queue };
};

describe("bootPlugins", () => {
  beforeEach(() => {
    window.localStorage.clear();
    startPluginHost.mockClear();
    updatePreferences({ pluginsEnabled: [] }, window);
  });

  it("imports nothing while no plugin is enabled", async () => {
    const { win, flush, queue } = fakeWin(true);
    bootPlugins(win);
    flush();
    await Promise.resolve();
    expect(queue).toEqual([]);
    expect(startPluginHost).not.toHaveBeenCalled();
    expect(pluginHostStarted.get()).toBe(false);
  });

  it("starts once on idle when plugins are enabled at boot", async () => {
    updatePreferences({ pluginsEnabled: ["a"] }, window);
    const { win, flush, queue } = fakeWin(true);
    bootPlugins(win);
    expect(startPluginHost).not.toHaveBeenCalled();
    expect(queue).toHaveLength(1);
    flush();
    await vi.waitFor(() => expect(startPluginHost).toHaveBeenCalledTimes(1));
  });

  it("falls back to a timeout without requestIdleCallback", async () => {
    updatePreferences({ pluginsEnabled: ["a"] }, window);
    const { win, flush } = fakeWin(false);
    bootPlugins(win);
    flush();
    await vi.waitFor(() => expect(startPluginHost).toHaveBeenCalledTimes(1));
  });

  it("starts once when the list first becomes non-empty", async () => {
    const { win, flush } = fakeWin(true);
    bootPlugins(win);
    updatePreferences({ pluginsEnabled: ["a"] }, window);
    updatePreferences({ pluginsEnabled: ["a", "b"] }, window);
    flush();
    await vi.waitFor(() => expect(startPluginHost).toHaveBeenCalledTimes(1));
    flush();
    expect(startPluginHost).toHaveBeenCalledTimes(1);
  });
});

describe("command runner fallback", () => {
  afterEach(() => setAppCommandRunner(null));

  it("uses the app runner when set, rejects unknown ids otherwise", async () => {
    expect(getAppCommandRunner()).toBeNull();
    await expect(runCommandById("nope.cmd")).rejects.toThrow(/unknown/);
    const run = vi.fn(() => true);
    setAppCommandRunner(run);
    await runCommandById("x.y");
    expect(run).toHaveBeenCalledWith("x.y");
    setAppCommandRunner(() => false);
    await expect(runCommandById("x.y")).rejects.toThrow(/unknown/);
  });
});
