import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_PREFERENCES,
  getPreferences,
  normalizePreferences,
  updatePreferences,
} from "../vault/preferences";
import {
  configToPreferences,
  disposeSettings,
  initSettings,
  PREFERENCES_CHANGED_EVENT,
  preferencesToConfigChanges,
  reloadSettings,
  type LoadSettingsResult,
} from "../vault/settingsSync";

const prefsWith = (hotkeys: Record<string, string[]>) => ({
  ...DEFAULT_PREFERENCES,
  hotkeys,
});

describe("preferences.hotkeys", () => {
  it("defaults to {} and drops bad entries on load", () => {
    expect(DEFAULT_PREFERENCES.hotkeys).toEqual({});
    expect(normalizePreferences({}).hotkeys).toEqual({});
    expect(
      normalizePreferences({
        hotkeys: { "file.save": ["Mod+S"], bad: "x", worse: [1], none: [] },
      }).hotkeys,
    ).toEqual({ "file.save": ["Mod+S"], none: [] });
    expect(normalizePreferences({ hotkeys: ["a"] }).hotkeys).toEqual({});
    expect(normalizePreferences({ hotkeys: null }).hotkeys).toEqual({});
  });

  it("persists in localStorage mode", () => {
    window.localStorage.clear();
    updatePreferences(
      { hotkeys: { "vault.newDrawing": ["Mod+Alt+N"] } },
      window,
    );
    expect(getPreferences(window).hotkeys).toEqual({
      "vault.newDrawing": ["Mod+Alt+N"],
    });
    window.localStorage.clear();
  });
});

describe("[hotkeys] -> preferences", () => {
  it("defaults to {} when the table is missing", () => {
    const { values, problems } = configToPreferences({});
    expect(values.hotkeys).toEqual({});
    expect(problems).toEqual([]);
  });

  it("parses chords to canonical form", () => {
    const { values, problems } = configToPreferences({
      hotkeys: {
        "vault.newDrawing": ["cmd+alt+n", "Mod+Alt+N", "CmdOrCtrl+,"],
        "view.zoomIn": [],
      },
    });
    expect(problems).toEqual([]);
    expect(values.hotkeys).toEqual({
      "vault.newDrawing": ["Alt+Meta+N", "Mod+Alt+N", "Mod+Comma"],
      "view.zoomIn": [],
    });
  });

  it("drops invalid chords with a problem, keeps the valid ones", () => {
    const { values, problems } = configToPreferences({
      hotkeys: { "vault.newDrawing": ["Mod+Nope", "Mod+Shift+N"] },
    });
    expect(values.hotkeys).toEqual({ "vault.newDrawing": ["Mod+Shift+N"] });
    expect(problems).toEqual([
      {
        kind: "invalid",
        key: "hotkeys.vault.newDrawing",
        message: expect.stringContaining("hotkeys.vault.newDrawing"),
      },
    ]);
  });

  it("keeps the defaults when every chord is invalid or the value is not a list", () => {
    const { values, problems } = configToPreferences({
      hotkeys: {
        "vault.newDrawing": ["Mod"],
        "file.save": "Mod+S",
        "view.zoomIn": [3],
      },
    });
    expect(values.hotkeys).toEqual({});
    expect(problems.map((p) => p.key)).toEqual([
      "hotkeys.vault.newDrawing",
      "hotkeys.file.save",
      "hotkeys.view.zoomIn",
    ]);
    expect(problems.every((p) => p.kind === "invalid")).toBe(true);
  });

  it("keeps unknown ids in a built-in namespace with a warning", () => {
    const { values, problems } = configToPreferences({
      hotkeys: { "palette.noSuchThing": ["Mod+J"] },
    });
    expect(values.hotkeys).toEqual({ "palette.noSuchThing": ["Mod+J"] });
    expect(problems).toEqual([
      {
        kind: "invalid",
        key: "hotkeys.palette.noSuchThing",
        message: "hotkeys: unknown command palette.noSuchThing",
      },
    ]);
  });

  it("keeps ids of other namespaces (plugin commands) without a warning", () => {
    const { values, problems } = configToPreferences({
      hotkeys: { "future.thing": ["Mod+J"] },
    });
    expect(values.hotkeys).toEqual({ "future.thing": ["Mod+J"] });
    expect(problems).toEqual([]);
  });

  it("accepts the legacy palette.quickSwitcher id without a warning", () => {
    const { values, problems } = configToPreferences({
      hotkeys: { "palette.quickSwitcher": ["Mod+K"] },
    });
    expect(values.hotkeys).toEqual({ "palette.quickSwitcher": ["Mod+K"] });
    expect(problems).toEqual([]);
  });

  it("reports a non-table [hotkeys]", () => {
    const { values, problems } = configToPreferences({ hotkeys: ["x"] });
    expect(values.hotkeys).toEqual({});
    expect(problems).toHaveLength(1);
  });
});

describe("preferences -> config changes", () => {
  it("emits per-id changes and null for removed ids", () => {
    const prev = prefsWith({ "file.save": ["Mod+Shift+S"], "view.zoomIn": [] });
    const next = prefsWith({
      "file.save": ["Mod+Shift+S"],
      "vault.newDrawing": ["Mod+Alt+N"],
    });
    expect(preferencesToConfigChanges(prev, next)).toEqual([
      { key: "hotkeys.view.zoomIn", value: null, default: expect.any(Array) },
      { key: "hotkeys.vault.newDrawing", value: ["Mod+Alt+N"] },
    ]);
    expect(preferencesToConfigChanges(next, next)).toEqual([]);
  });

  it("round trips prefs -> changes -> config -> prefs", () => {
    const next = prefsWith({
      "vault.newDrawing": ["Mod+Alt+N", "Mod+Shift+N"],
      "view.zoomIn": [],
    });
    const config: Record<string, unknown> = { hotkeys: {} };
    for (const { key, value } of preferencesToConfigChanges(
      DEFAULT_PREFERENCES,
      next,
    )) {
      (config.hotkeys as Record<string, unknown>)[
        key.slice("hotkeys.".length)
      ] = value;
    }
    const { values, problems } = configToPreferences(config);
    expect(problems).toEqual([]);
    expect(values.hotkeys).toEqual(next.hotkeys);
  });
});

describe("hotkeys live reload", () => {
  type Config = Record<string, Record<string, unknown>>;
  const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

  const createBackend = () => {
    const backend = {
      config: { hotkeys: {} } as Config,
      handler: null as null | ((e: { payload: unknown }) => void),
      invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
        switch (cmd) {
          case "load_settings":
            return {
              configDir: "/c",
              configPath: "/c/config.toml",
              statePath: "/s/state.json",
              config: clone(backend.config),
              configError: null,
              state: {},
            } as LoadSettingsResult;
          case "update_config":
            for (const { key, value } of (
              args as { changes: { key: string; value: unknown }[] }
            ).changes) {
              const dot = key.indexOf(".");
              const table = key.slice(0, dot);
              const name = key.slice(dot + 1);
              backend.config[table] ??= {};
              if (value === null) {
                delete backend.config[table][name];
              } else {
                backend.config[table][name] = value;
              }
            }
            return undefined;
          case "write_state":
            return undefined;
          default:
            throw new Error(`unknown command ${cmd}`);
        }
      }),
      listen: vi.fn(async (_event: string, handler: never) => {
        backend.handler = handler;
        return () => undefined;
      }),
    };
    return backend;
  };

  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    disposeSettings();
    window.localStorage.clear();
  });

  it("writes overrides, deletes lines with null, fires an event on hand edits", async () => {
    const backend = createBackend();
    await initSettings(window, {
      tauri: true,
      invoke: backend.invoke as never,
      listen: backend.listen as never,
    });
    expect(getPreferences(window).hotkeys).toEqual({});

    // GUI edit -> per-id write
    updatePreferences(
      { hotkeys: { "vault.newDrawing": ["Mod+Alt+N"] } },
      window,
    );
    await reloadSettings();
    expect(backend.config.hotkeys).toEqual({
      "vault.newDrawing": ["Mod+Alt+N"],
    });

    // removing the override deletes the line
    updatePreferences({ hotkeys: {} }, window);
    await reloadSettings();
    expect(backend.config.hotkeys).toEqual({});

    const onChange = vi.fn();
    window.addEventListener(PREFERENCES_CHANGED_EVENT, onChange);
    try {
      // hand edit -> live update + event
      backend.config.hotkeys["file.save"] = ["cmd+shift+s"];
      await reloadSettings();
      expect(getPreferences(window).hotkeys).toEqual({
        "file.save": ["Shift+Meta+S"],
      });
      expect(onChange).toHaveBeenCalledTimes(1);

      // same content, different order: no event
      await reloadSettings();
      expect(onChange).toHaveBeenCalledTimes(1);

      // deleting the table resets live
      delete (backend.config as Record<string, unknown>).hotkeys;
      await reloadSettings();
      expect(getPreferences(window).hotkeys).toEqual({});
      expect(onChange).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener(PREFERENCES_CHANGED_EVENT, onChange);
    }
  });
});
