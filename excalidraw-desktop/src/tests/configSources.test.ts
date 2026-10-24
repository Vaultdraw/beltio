import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BUILTIN_COMMANDS } from "../commands/commands";
import {
  CONFIG_COMMAND_HANDLERS,
  CONFIG_COMMAND_IDS,
  cancelResetRequest,
  confirmResetOverrides,
  getResetRequest,
} from "../commands/configCommands";
import { keySource, sourceFileOf } from "../vault/configSources";
import { DEFAULT_PREFERENCES, getPreferences } from "../vault/preferences";
import {
  disposeSettings,
  getSettingsStatus,
  initSettings,
  reloadSettings,
  resetConfigKey,
  resetOverrides,
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
  path: `/x/${kind}.toml`,
  status: error ? "error" : config ? "ok" : "missing",
  error,
  config,
});

describe("keySource", () => {
  const cfg = layer("config", {
    editor: { font_size: 14, roughness: 1 },
    hotkeys: { "vault.newDrawing": ["Mod+N"] },
  });

  it("is default when no layer sets the key", () => {
    expect(keySource([cfg, layer("overrides", {})], "interface.zoom")).toEqual({
      source: "default",
    });
    expect(keySource(undefined, "editor.font_size")).toEqual({
      source: "default",
    });
  });

  it("names config.toml when only it sets the key", () => {
    expect(
      keySource([cfg, layer("overrides", null)], "editor.font_size"),
    ).toEqual({ source: "config.toml", value: 14 });
  });

  it("names overrides.toml and the value it hides", () => {
    const over = layer("overrides", { editor: { font_size: 20 } });
    expect(keySource([cfg, over], "editor.font_size")).toEqual({
      source: "overrides.toml",
      value: 20,
      hidden: { file: "config.toml", value: 14 },
    });
  });

  it("does not report a hidden value that is the same", () => {
    const over = layer("overrides", { editor: { roughness: 1 } });
    expect(keySource([cfg, over], "editor.roughness").hidden).toBeUndefined();
  });

  it("finds hotkeys by command id, dots included", () => {
    expect(keySource([cfg], "hotkeys.vault.newDrawing").source).toBe(
      "config.toml",
    );
  });

  it("a layer that did not parse sets nothing", () => {
    const broken = layer("overrides", null, { message: "bad", line: 1 });
    expect(keySource([cfg, broken], "editor.font_size").source).toBe(
      "config.toml",
    );
  });

  it("sourceFileOf falls back to config.toml", () => {
    expect(sourceFileOf(undefined, "editor.font_size")).toBe("config.toml");
    expect(
      sourceFileOf(
        [cfg, layer("overrides", { editor: { font_size: 20 } })],
        "editor.font_size",
      ),
    ).toBe("overrides.toml");
  });
});

type Call = { cmd: string; args?: Record<string, unknown> };

const start = async (first: LoadSettingsResult) => {
  const calls: Call[] = [];
  let current = first;
  const invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    calls.push({ cmd, args });
    if (cmd === "load_settings") {
      return current;
    }
    if (cmd === "reset_overrides") {
      return true;
    }
    return undefined;
  });
  await initSettings(window, {
    invoke: invoke as never,
    listen: (async () => () => undefined) as never,
    tauri: true,
  });
  return { calls, set: (next: LoadSettingsResult) => (current = next) };
};

const payload = (
  config: Record<string, unknown>,
  layers: LayerPayload[],
): LoadSettingsResult => ({
  configDir: "/x",
  configPath: "/x/config.toml",
  statePath: "/x/state.json",
  config,
  configError: null,
  overridesError: null,
  layers,
  state: {},
});

describe("settingsSync: layers, resets and messages", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => {
    disposeSettings();
    window.localStorage.clear();
  });

  it("an invalid value names the file it came from", async () => {
    await start(
      payload({ editor: { font_size: "big" } }, [
        layer("config", { editor: { font_size: 14 } }),
        layer("overrides", { editor: { font_size: "big" } }),
      ]),
    );
    const messages = getSettingsStatus().problems.map((p) => p.message);
    expect(
      messages.some((m) => m.startsWith("overrides.toml: editor.font_size")),
    ).toBe(true);
    expect(
      messages.some((m) => m.startsWith("config.toml: editor.font_size")),
    ).toBe(false);
  });

  it("the status carries the layers, and a broken layer keeps its last good content", async () => {
    const good = payload({ editor: { font_size: 20 } }, [
      layer("config", { editor: { font_size: 14 } }),
      layer("overrides", { editor: { font_size: 20 } }),
    ]);
    const backend = await start(good);
    expect(getSettingsStatus().layers).toHaveLength(2);
    backend.set({
      ...payload({ editor: { font_size: 14 } }, [
        layer("config", { editor: { font_size: 14 } }),
        layer("overrides", null, { message: "bad", line: 1 }),
      ]),
      overridesError: { message: "bad", line: 1 },
    });
    await reloadSettings();
    const over = getSettingsStatus().layers?.find(
      (l) => l.kind === "overrides",
    );
    expect(over?.status).toBe("error");
    // Chips still know the override (the app keeps showing 20).
    expect(over?.config).toEqual({ editor: { font_size: 20 } });
  });

  it("resetConfigKey sends null with no hint, then reloads", async () => {
    const backend = await start(payload({}, [layer("config", {})]));
    await resetConfigKey("editor.font_size");
    const writes = backend.calls.filter((c) => c.cmd === "update_config");
    expect(writes).toEqual([
      {
        cmd: "update_config",
        args: { changes: [{ key: "editor.font_size", value: null }] },
      },
    ]);
    expect(backend.calls.at(-1)?.cmd).toBe("load_settings");
  });

  it("resetConfigKey with toDefault sends the built-in default as the hint", async () => {
    const backend = await start(payload({}, [layer("config", {})]));
    await resetConfigKey("editor.font_size", true);
    expect(backend.calls.find((c) => c.cmd === "update_config")?.args).toEqual({
      changes: [
        {
          key: "editor.font_size",
          value: null,
          default: DEFAULT_PREFERENCES.defaultFontSize,
        },
      ],
    });
  });

  it("resetConfigKey refuses a key Settings does not own", async () => {
    await start(payload({}, [layer("config", {})]));
    await expect(resetConfigKey("nope.key")).rejects.toThrow(
      /not a Settings key/,
    );
  });

  it("resetOverrides deletes the file, reloads, and the value comes back from config.toml", async () => {
    const backend = await start(
      payload({ editor: { font_size: 20 } }, [
        layer("config", { editor: { font_size: 14 } }),
        layer("overrides", { editor: { font_size: 20 } }),
      ]),
    );
    expect(getPreferences(window).defaultFontSize).toBe(20);
    backend.set(
      payload({ editor: { font_size: 14 } }, [
        layer("config", { editor: { font_size: 14 } }),
        layer("overrides", null),
      ]),
    );
    expect(await resetOverrides()).toBe(true);
    expect(backend.calls.map((c) => c.cmd).slice(-2)).toEqual([
      "reset_overrides",
      "load_settings",
    ]);
    expect(getPreferences(window).defaultFontSize).toBe(14);
  });
});

describe("config commands", () => {
  it("are registered, in the Config category, with no default key", () => {
    for (const id of Object.values(CONFIG_COMMAND_IDS)) {
      const command = BUILTIN_COMMANDS.find((c) => c.id === id);
      expect(command, id).toBeDefined();
      expect(command?.category).toBe("Config");
      expect(command?.keys.default).toEqual([]);
      expect(CONFIG_COMMAND_HANDLERS[id], id).toBeTypeOf("function");
    }
  });

  describe("config.resetOverrides", () => {
    beforeEach(() => window.localStorage.clear());
    afterEach(() => {
      cancelResetRequest();
      disposeSettings();
    });

    it("asks first and deletes nothing until confirmed", async () => {
      const backend = await start(payload({}, [layer("config", {})]));
      await CONFIG_COMMAND_HANDLERS[CONFIG_COMMAND_IDS.resetOverrides]?.();
      expect(getResetRequest()).toBe(true);
      expect(backend.calls.some((c) => c.cmd === "reset_overrides")).toBe(
        false,
      );
      cancelResetRequest();
      expect(getResetRequest()).toBe(false);
      expect(backend.calls.some((c) => c.cmd === "reset_overrides")).toBe(
        false,
      );
      await confirmResetOverrides();
      expect(
        backend.calls.filter((c) => c.cmd === "reset_overrides"),
      ).toHaveLength(1);
    });
  });
});
