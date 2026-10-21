import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PREFERENCES, getPreferences } from "../../vault/preferences";
import {
  parsePluginTable,
  pluginSettingsChanges,
} from "../../vault/pluginSettingsTable";
import {
  configToPreferences,
  preferencesToConfigChanges,
} from "../../vault/settingsSync";
import {
  attachVaultSettings,
  detachVaultSettings,
  getVaultSettingsSnapshot,
  parseVaultSettings,
} from "../../vault/vaultSettings";

import {
  effectiveSetting,
  validateSettingValue,
  type SettingDecl,
} from "./declaredSettings";
import {
  getPluginSetting,
  pluginSettingProblems,
  setPluginSetting,
} from "./pluginSettings";
import {
  getPluginSettingsVersion,
  pluginSettingsDecls,
  registerPluginSettings,
  subscribePluginSettings,
} from "./registry";

const decl = (over: Partial<SettingDecl> & Pick<SettingDecl, "key">) =>
  ({
    type: "int",
    title: over.key,
    default: 3,
    min: 1,
    max: 10,
    ...over,
  } as SettingDecl);

describe("[plugin] parsing", () => {
  it("is free when absent", () => {
    expect(parsePluginTable(undefined, "x")).toEqual({
      settings: {},
      problems: [],
    });
  });

  it("keeps valid ids and keys, reports the rest", () => {
    const { settings, problems } = parsePluginTable(
      {
        "my-plugin": { size: 4, on: true, "bad key": 1, nested: { a: 1 } },
        Bad_Id: { a: 1 },
        notTable: 5,
      },
      "config.toml",
    );
    expect(settings).toEqual({ "my-plugin": { size: 4, on: true } });
    expect(problems.map((p) => p.key)).toEqual([
      "plugin.my-plugin.bad key",
      "plugin.my-plugin.nested",
      "plugin.Bad_Id",
      "plugin.notTable",
    ]);
  });

  it("reports a non-table [plugin]", () => {
    const { settings, problems } = parsePluginTable([1], "config.toml");
    expect(settings).toEqual({});
    expect(problems[0].key).toBe("plugin");
  });

  it("flows through config and vault settings parsing", () => {
    const config = { plugin: { a: { x: 1 } } };
    expect(configToPreferences(config).values.pluginSettings).toEqual({
      a: { x: 1 },
    });
    expect(configToPreferences({}).values.pluginSettings).toEqual({});
    expect(parseVaultSettings(config).pluginOverrides).toEqual({ a: { x: 1 } });
  });
});

describe("preferences -> config changes", () => {
  const prefs = (pluginSettings: Record<string, any>) => ({
    ...DEFAULT_PREFERENCES,
    pluginSettings,
  });

  it("sets, changes and deletes one table per plugin", () => {
    const none = prefs({});
    const one = prefs({ a: { x: 1 } });
    const two = prefs({ a: { x: 1, y: "s" }, b: { z: true } });
    expect(preferencesToConfigChanges(none, one)).toEqual([
      { key: "plugin.a", value: { x: 1 } },
    ]);
    expect(preferencesToConfigChanges(one, two)).toEqual([
      { key: "plugin.a", value: { x: 1, y: "s" } },
      { key: "plugin.b", value: { z: true } },
    ]);
    expect(preferencesToConfigChanges(two, none)).toEqual([
      { key: "plugin.a", value: null },
      { key: "plugin.b", value: null },
    ]);
    expect(preferencesToConfigChanges(one, one)).toEqual([]);
  });

  it("ignores key order", () => {
    expect(
      pluginSettingsChanges({ a: { x: 1, y: 2 } }, { a: { y: 2, x: 1 } }),
    ).toEqual([]);
  });
});

describe("validation", () => {
  it("checks int bounds and integrality", () => {
    const d = decl({ key: "n" });
    expect(validateSettingValue(d, 5).ok).toBe(true);
    expect(validateSettingValue(d, 0).ok).toBe(false);
    expect(validateSettingValue(d, 11).ok).toBe(false);
    expect(validateSettingValue(d, 2.5).ok).toBe(false);
    expect(validateSettingValue(d, "5").ok).toBe(false);
    expect(
      validateSettingValue(decl({ key: "f", type: "number" }), 2.5).ok,
    ).toBe(true);
  });

  it("checks select options, colours, bools and strings", () => {
    const sel = decl({
      key: "s",
      type: "select",
      default: "a",
      options: [{ value: "a", label: "A" }],
    });
    expect(validateSettingValue(sel, "a").ok).toBe(true);
    expect(validateSettingValue(sel, "b").ok).toBe(false);
    const color = decl({ key: "c", type: "color", default: "#fff" });
    expect(validateSettingValue(color, "#1e1e1e").ok).toBe(true);
    expect(validateSettingValue(color, "red").ok).toBe(false);
    expect(
      validateSettingValue(decl({ key: "b", type: "bool", default: true }), 1)
        .ok,
    ).toBe(false);
    expect(
      validateSettingValue(decl({ key: "t", type: "string", default: "" }), "x")
        .ok,
    ).toBe(true);
  });

  it("resolves vault, then global, then default", () => {
    const d = decl({ key: "n" });
    expect(effectiveSetting(d, 4, 6)).toBe(6);
    expect(effectiveSetting(d, 4, undefined)).toBe(4);
    expect(effectiveSetting(d, undefined, undefined)).toBe(3);
    expect(effectiveSetting(d, 4, 99)).toBe(4); // invalid vault value skipped
    expect(effectiveSetting(d, 99, undefined)).toBe(3);
    expect(effectiveSetting(decl({ key: "n", scope: ["global"] }), 4, 6)).toBe(
      4,
    );
  });
});

describe("registry", () => {
  it("registers, notifies and disposes", () => {
    const cb = vi.fn();
    const off = subscribePluginSettings(cb);
    const v0 = getPluginSettingsVersion();
    const list = [decl({ key: "n" })];
    const dispose = registerPluginSettings("reg-test", list);
    expect(pluginSettingsDecls("reg-test")).toEqual(list);
    expect(pluginSettingsDecls("reg-test")).toBe(
      pluginSettingsDecls("reg-test"),
    );
    expect(getPluginSettingsVersion()).toBe(v0 + 1);
    dispose();
    expect(pluginSettingsDecls("reg-test")).toEqual([]);
    expect(cb).toHaveBeenCalledTimes(2);
    off();
  });

  it("a stale dispose does not remove a newer registration", () => {
    const first = registerPluginSettings("stale", [decl({ key: "n" })]);
    const second = registerPluginSettings("stale", [decl({ key: "m" })]);
    first();
    expect(pluginSettingsDecls("stale")).toHaveLength(1);
    second();
  });

  it("rejects bad ids, duplicate keys and bad defaults", () => {
    expect(() => registerPluginSettings("Bad Id", [])).toThrow();
    expect(() =>
      registerPluginSettings("dup", [decl({ key: "n" }), decl({ key: "n" })]),
    ).toThrow();
    expect(() =>
      registerPluginSettings("baddef", [decl({ key: "n", default: 99 })]),
    ).toThrow();
  });
});

describe("get/set", () => {
  let dispose: () => void;
  beforeEach(() => {
    window.localStorage.clear();
    dispose = registerPluginSettings("gs", [
      decl({ key: "n" }),
      decl({ key: "g", scope: ["global"] }),
    ]);
  });
  afterEach(() => {
    dispose();
    detachVaultSettings();
    window.localStorage.clear();
  });

  it("writes global values and falls back to the default", async () => {
    expect(getPluginSetting("gs", "n", window)).toBe(3);
    expect(await setPluginSetting("gs", "n", 7, "global", window)).toBe(true);
    expect(getPreferences(window).pluginSettings).toEqual({ gs: { n: 7 } });
    expect(getPluginSetting("gs", "n", window)).toBe(7);
    await setPluginSetting("gs", "n", undefined, "global", window);
    expect(getPreferences(window).pluginSettings).toEqual({});
  });

  it("refuses invalid values and disallowed layers", async () => {
    expect(await setPluginSetting("gs", "n", 99, "global", window)).toBe(false);
    expect(await setPluginSetting("gs", "g", 5, "vault", window)).toBe(false);
    expect(await setPluginSetting("gs", "n", 5, "vault", window)).toBe(false); // no vault
  });

  it("vault override beats global and is written as one table", async () => {
    const files: Record<string, any> = {};
    const invoke = vi.fn(async (cmd: string, args?: any) => {
      if (cmd === "load_vault_settings") {
        return {
          path: "p",
          settings: structuredClone(files),
          settingsError: null,
        };
      }
      for (const { key, value } of args.changes) {
        const [t, id] = key.split(".");
        files[t] ??= {};
        if (value === null) {
          delete files[t][id];
        } else {
          files[t][id] = value;
        }
      }
      return undefined;
    });
    await attachVaultSettings(window, "h", {
      tauri: true,
      invoke: invoke as any,
      listen: (async () => () => {}) as any,
    });
    await setPluginSetting("gs", "n", 4, "global", window);
    await setPluginSetting("gs", "n", 8, "vault", window);
    expect(files).toEqual({ plugin: { gs: { n: 8 } } });
    expect(getVaultSettingsSnapshot().pluginOverrides).toEqual({
      gs: { n: 8 },
    });
    expect(getPluginSetting("gs", "n", window)).toBe(8);
    await setPluginSetting("gs", "n", undefined, "vault", window);
    expect(files.plugin).toEqual({});
    expect(getPluginSetting("gs", "n", window)).toBe(4);
  });

  it("reports stored values that fail their declaration", async () => {
    window.localStorage.clear();
    const { updatePreferences } = await import("../../vault/preferences");
    updatePreferences({ pluginSettings: { gs: { n: 99 } } }, window);
    const problems = pluginSettingProblems(
      "gs",
      pluginSettingsDecls("gs"),
      window,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0].key).toBe("plugin.gs.n");
    expect(getPluginSetting("gs", "n", window)).toBe(3);
  });
});
