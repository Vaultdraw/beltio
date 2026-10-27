import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getAppCommandRunner,
  setAppCommandRunner,
} from "../commands/appRunner";

import { getRegisteredCommand, registerCommands } from "../commands/registry";
import { getRegisteredHandler } from "../commands/handlerRegistry";
import { getPreferences, updatePreferences } from "../vault/preferences";

import { runCommandById } from "./host/runner";

import { bootPlugins, ensurePluginHost } from "./boot";
import { pluginHostStarted } from "./hostFlag";
import { findImporter, runImports } from "./importerMap";
import { resetImporterMap, setImportRunner } from "./importerMapAdmin";

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

  it("official stubs follow the enabled list: a late enable registers them, a disable drops them", () => {
    const { win } = fakeWin(true);
    bootPlugins(win);
    expect(getRegisteredHandler("markdown-import.obsidian-new-vault")).toBe(
      undefined,
    );
    updatePreferences({ pluginsEnabled: ["markdown-import"] }, window);
    expect(
      getRegisteredHandler("markdown-import.obsidian-new-vault"),
    ).toBeTypeOf("function");
    updatePreferences({ pluginsEnabled: [] }, window);
    expect(getRegisteredHandler("markdown-import.obsidian-new-vault")).toBe(
      undefined,
    );
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

describe("official plugins (on by default, no startup cost)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    startPluginHost.mockClear();
  });
  afterEach(() => {
    resetImporterMap();
    setAppCommandRunner(null);
  });

  it("is enabled by default, yet boot starts no host and registers stubs", () => {
    expect(getPreferences(window).pluginsEnabled).toEqual([
      "markdown-import",
      "gallery",
      "graph",
      "mermaid",
    ]);
    const { win, flush, queue } = fakeWin(true);
    bootPlugins(win);
    flush();
    expect(queue).toEqual([]);
    expect(startPluginHost).not.toHaveBeenCalled();
    expect(pluginHostStarted.get()).toBe(false);
    expect(
      getRegisteredCommand("markdown-import.import")?.keys.default,
    ).toEqual([]);
    expect(findImporter("Note.md")).toMatchObject({
      pluginId: "markdown-import",
      importerId: "md",
    });
    expect(findImporter("a.excalidraw.md")?.extension).toBe("md");
  });

  it("registers nothing when the user turned it off (enabled = [])", () => {
    updatePreferences({ pluginsEnabled: [] }, window);
    const { win } = fakeWin(true);
    bootPlugins(win);
    expect(findImporter("Note.md")).toBeNull();
    expect(getRegisteredCommand("markdown-import.import")).toBeUndefined();
    updatePreferences({ pluginsEnabled: ["markdown-import"] }, window);
  });

  it("the first use starts the host and runs the real command", async () => {
    const { win } = fakeWin(true);
    bootPlugins(win);
    startPluginHost.mockImplementationOnce(async () => {
      // The host registers the real command under the same id once the stubs are gone.
      expect(getRegisteredCommand("markdown-import.import")).toBeUndefined();
      registerCommands([
        {
          id: "markdown-import.import",
          title: "Import: Markdown…",
          category: "Markdown import",
          keys: { default: [] },
        },
      ]);
      return {};
    });
    const run = vi.fn(() => true);
    setAppCommandRunner(run);
    await getRegisteredHandler("markdown-import.import")!();
    expect(startPluginHost).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("markdown-import.import");
  });

  it("a .md import starts the host on demand (runImports)", async () => {
    const { win } = fakeWin(true);
    bootPlugins(win);
    startPluginHost.mockImplementationOnce(async () => {
      setImportRunner(async () => {});
      return {};
    });
    const file = new File(["# x"], "Note.md");
    const ran = await runImports([{ file, match: findImporter("Note.md")! }], {
      path: null,
      at: { x: 0, y: 0 },
    });
    expect(ran).toBe(true);
    expect(startPluginHost).toHaveBeenCalledTimes(1);
  });

  it("only official plugins in the list leave the host unstarted; a user plugin starts it", () => {
    updatePreferences({ pluginsEnabled: ["markdown-import", "mine"] }, window);
    const { win, queue } = fakeWin(true);
    bootPlugins(win);
    expect(queue).toHaveLength(1);
    updatePreferences({ pluginsEnabled: ["markdown-import"] }, window);
  });
});

describe("ensurePluginHost", () => {
  it("shares one start while it is in flight", async () => {
    startPluginHost.mockClear();
    const { win } = fakeWin(true);
    await Promise.all([ensurePluginHost(win), ensurePluginHost(win)]);
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
