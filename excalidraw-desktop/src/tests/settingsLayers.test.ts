import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PREFERENCES, getPreferences } from "../vault/preferences";
import {
  disposeSettings,
  getSettingsStatus,
  initSettings,
  preferencesToConfigChanges,
  reloadSettings,
  type LayerPayload,
  type LoadSettingsResult,
} from "../vault/settingsSync";

const layer = (
  kind: "config" | "overrides",
  config: Record<string, unknown> | null,
  error: LayerPayload["error"] = null,
): LayerPayload => ({
  id: kind === "config" ? 0 : 1,
  kind,
  path: `/x/${kind === "config" ? "config" : "overrides"}.toml`,
  status: error ? "error" : config ? "ok" : "missing",
  error,
  config,
});

const payload = (
  config: Record<string, unknown> | null,
  layers: LayerPayload[],
  extra: Partial<LoadSettingsResult> = {},
): LoadSettingsResult => ({
  configDir: "/x",
  configPath: "/x/config.toml",
  statePath: "/x/state.json",
  config,
  configError: null,
  overridesError: null,
  layers,
  state: {},
  ...extra,
});

const start = async (first: LoadSettingsResult) => {
  let current = first;
  const invoke = vi.fn(async (cmd: string) => {
    if (cmd === "load_settings") {
      return current;
    }
    return undefined;
  });
  const listen = vi.fn(async () => () => undefined);
  await initSettings(window, {
    invoke: invoke as never,
    listen: listen as never,
    tauri: true,
  });
  return { set: (next: LoadSettingsResult) => (current = next) };
};

describe("preferencesToConfigChanges: defaults as hints", () => {
  const prev = { ...DEFAULT_PREFERENCES, defaultFontSize: 30 };

  it("sends null with the built-in default when a value goes back to it", () => {
    const next = {
      ...prev,
      defaultFontSize: DEFAULT_PREFERENCES.defaultFontSize,
    };
    expect(preferencesToConfigChanges(prev, next)).toEqual([
      {
        key: "editor.font_size",
        value: null,
        default: DEFAULT_PREFERENCES.defaultFontSize,
      },
    ]);
  });

  it("sends a plain value, with no hint, when it differs from the default", () => {
    const next = { ...DEFAULT_PREFERENCES, defaultFontSize: 31 };
    expect(preferencesToConfigChanges(prev, next)).toEqual([
      { key: "editor.font_size", value: 31 },
    ]);
  });

  it("hints the default chords of a command whose keys are reset", () => {
    const withKey = {
      ...DEFAULT_PREFERENCES,
      hotkeys: { "vault.newDrawing": ["Mod+K"] },
    };
    const changes = preferencesToConfigChanges(withKey, DEFAULT_PREFERENCES);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      key: "hotkeys.vault.newDrawing",
      value: null,
    });
    expect(Array.isArray(changes[0].default)).toBe(true);
    expect((changes[0].default as string[]).length).toBeGreaterThan(0);
  });
});

describe("settingsSync layers", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => {
    disposeSettings();
    window.localStorage.clear();
  });

  const cfgLayer = layer("config", { editor: { font_size: 14 } });

  it("applies the merged config and names the file of each unknown key", async () => {
    const over = layer("overrides", {
      editor: { font_size: 20 },
      zoomy: { a: 1 },
    });
    const cfg = layer("config", { editor: { font_size: 14, roughnes: 2 } });
    await start(
      payload({ editor: { font_size: 20, roughnes: 2 }, zoomy: { a: 1 } }, [
        cfg,
        over,
      ]),
    );
    expect(getPreferences(window).defaultFontSize).toBe(20);
    const messages = getSettingsStatus().problems.map((p) => p.message);
    expect(
      messages.some((m) =>
        m.startsWith("config.toml: unknown key editor.roughnes"),
      ),
    ).toBe(true);
    expect(
      messages.some((m) => m.startsWith("overrides.toml: unknown key zoomy")),
    ).toBe(true);
  });

  it("at startup a broken overrides.toml is named and config.toml still applies", async () => {
    const over = layer("overrides", null, { message: "bad", line: 3 });
    await start(
      payload({ editor: { font_size: 14 } }, [cfgLayer, over], {
        overridesError: { message: "bad", line: 3 },
      }),
    );
    expect(getPreferences(window).defaultFontSize).toBe(14);
    expect(getSettingsStatus().problems.map((p) => p.message)).toContain(
      "overrides.toml line 3: bad",
    );
  });

  it("a layer that fails on a reload keeps the whole previous result", async () => {
    const good = payload({ editor: { font_size: 20 } }, [
      layer("config", { editor: { font_size: 14 } }),
      layer("overrides", { editor: { font_size: 20 } }),
    ]);
    const backend = await start(good);
    expect(getPreferences(window).defaultFontSize).toBe(20);
    // The overrides file breaks: the backend still merges config.toml, but TypeScript keeps 20.
    backend.set(
      payload(
        { editor: { font_size: 14 } },
        [cfgLayer, layer("overrides", null, { message: "bad", line: 1 })],
        {
          overridesError: { message: "bad", line: 1 },
        },
      ),
    );
    await reloadSettings();
    expect(getPreferences(window).defaultFontSize).toBe(20);
    expect(getSettingsStatus().problems.map((p) => p.message)).toContain(
      "overrides.toml line 1: bad",
    );
    // Fixed again: the new value applies and the problem clears.
    backend.set(
      payload({ editor: { font_size: 22 } }, [
        layer("config", { editor: { font_size: 22 } }),
      ]),
    );
    await reloadSettings();
    expect(getPreferences(window).defaultFontSize).toBe(22);
    expect(getSettingsStatus().problems).toEqual([]);
  });
});

describe("preferencesToConfigChanges: more hints", () => {
  it("rebinding a command to its default chords is a reset, with the hint", () => {
    const base = {
      ...DEFAULT_PREFERENCES,
      hotkeys: { "file.rename": ["Mod+R"] },
    };
    const probe = preferencesToConfigChanges(base, DEFAULT_PREFERENCES)[0]
      .default as string[];
    const back = { ...DEFAULT_PREFERENCES, hotkeys: { "file.rename": probe } };
    expect(preferencesToConfigChanges(base, back)).toEqual([
      { key: "hotkeys.file.rename", value: null, default: probe },
    ]);
  });

  it("resetting a plugin's settings hints an empty table", () => {
    const withPlugin = {
      ...DEFAULT_PREFERENCES,
      pluginSettings: { p: { a: 1 } },
    };
    expect(preferencesToConfigChanges(withPlugin, DEFAULT_PREFERENCES)).toEqual(
      [{ key: "plugin.p", value: null, default: {} }],
    );
  });
});
