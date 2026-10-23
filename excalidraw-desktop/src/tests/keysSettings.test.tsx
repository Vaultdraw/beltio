import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_KEY_OPTIONS } from "../commands/keySequence";
import {
  DEFAULT_KEY_SETTINGS,
  KEYS_DEFAULTS,
  KEYS_FIELDS,
  checkKeyLabel,
  sameKeySequence,
  normalizeKeysPreferences,
  toKeySettings,
} from "../commands/keySettings";
import { buildKeyTrie } from "../commands/keyTrie";
import { useKeyOptions } from "../commands/useKeyOptions";
import {
  DEFAULT_PREFERENCES,
  getPreferences,
  updatePreferences,
} from "../vault/preferences";
import {
  CONFIG_MAPPING,
  configToPreferences,
  disposeSettings,
  initSettings,
  preferencesToConfigChanges,
  reloadSettings,
  type LoadSettingsResult,
} from "../vault/settingsSync";

import type { CommandDefinition } from "../commands/types";

const GOOD = {
  leader: "Space",
  timeout_ms: 250,
  cancel_after_ms: 0,
  which_key: false,
  which_key_delay_ms: 0,
  which_key_position: "center",
};

const FIELD_OF: Record<string, string> = {
  leader: "keysLeader",
  timeout_ms: "keysTimeoutMs",
  cancel_after_ms: "keysCancelAfterMs",
  which_key: "keysWhichKey",
  which_key_delay_ms: "keysWhichKeyDelayMs",
  which_key_position: "keysWhichKeyPosition",
};

const BAD: Record<string, unknown[]> = {
  leader: ["Nope+Nope", "g g", "<leader>", "", 5],
  timeout_ms: [-1, 1.5, "1000", 4_000_000],
  cancel_after_ms: [-5, true],
  which_key: ["yes", 1],
  which_key_delay_ms: [-1, "x"],
  which_key_position: ["top", 3],
};

const prefsOf = (keys: unknown) =>
  configToPreferences({ keys }) as ReturnType<typeof configToPreferences>;

describe("[keys] defaults", () => {
  it("match the plan and the resolver defaults", () => {
    expect(KEYS_DEFAULTS).toEqual({
      keysLeader: "Backslash",
      keysTimeoutMs: 1000,
      keysCancelAfterMs: 5000,
      keysWhichKey: true,
      keysWhichKeyDelayMs: 400,
      keysWhichKeyPosition: "bottom",
      keysLabels: {},
    });
    expect(toKeySettings(KEYS_DEFAULTS)).toEqual(DEFAULT_KEY_SETTINGS);
    expect(DEFAULT_KEY_SETTINGS).toMatchObject(DEFAULT_KEY_OPTIONS);
    for (const field of KEYS_FIELDS) {
      expect(DEFAULT_PREFERENCES[field]).toBe(KEYS_DEFAULTS[field]);
    }
  });

  it("are used when there is no [keys] table, without problems", () => {
    const { values, problems } = configToPreferences({});
    expect(problems).toEqual([]);
    for (const field of KEYS_FIELDS) {
      expect(values[field]).toBe(KEYS_DEFAULTS[field]);
    }
    expect(values.keysLabels).toEqual({});
  });
});

describe("[keys] parsing", () => {
  it("reads every good value", () => {
    const { values, problems } = prefsOf(GOOD);
    expect(problems).toEqual([]);
    for (const [key, value] of Object.entries(GOOD)) {
      expect((values as Record<string, unknown>)[FIELD_OF[key]]).toBe(value);
    }
  });

  it("accepts the Vim alias and the old chord notation for the leader", () => {
    expect(prefsOf({ leader: "<Space>" }).problems).toEqual([]);
    expect(prefsOf({ leader: "<Space>" }).values.keysLeader).toBe("<Space>");
    expect(prefsOf({ leader: "Mod + K" }).problems).toEqual([]);
  });

  for (const [key, bad] of Object.entries(BAD)) {
    it(`${key}: a bad value gives the default and a problem naming it`, () => {
      for (const value of bad) {
        // another good key proves the rest still loads
        const { values, problems } = prefsOf({
          ...GOOD,
          [key]: value,
        });
        const field = FIELD_OF[key] as keyof typeof values;
        expect(values[field]).toBe(
          KEYS_DEFAULTS[field as keyof typeof KEYS_DEFAULTS],
        );
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatchObject({
          kind: "invalid",
          key: `keys.${key}`,
        });
        expect(problems[0].message).toContain(`keys.${key}`);
        for (const [other, good] of Object.entries(GOOD)) {
          if (other !== key) {
            expect((values as Record<string, unknown>)[FIELD_OF[other]]).toBe(
              good,
            );
          }
        }
      }
    });
  }

  it("a missing key keeps its default", () => {
    const { values, problems } = prefsOf({ timeout_ms: 10 });
    expect(problems).toEqual([]);
    expect(values.keysTimeoutMs).toBe(10);
    expect(values.keysLeader).toBe("Backslash");
  });

  it("warns about unknown [keys] keys and still loads the rest", () => {
    const { values, problems } = prefsOf({ leader: "Space", lead: "x" });
    expect(values.keysLeader).toBe("Space");
    expect(problems).toEqual([
      {
        kind: "unknown",
        key: "keys.lead",
        message: "config.toml: unknown key keys.lead (ignored)",
      },
    ]);
  });

  it("reports a non-table [keys]", () => {
    const { values, problems } = prefsOf("x");
    expect(values.keysLeader).toBe("Backslash");
    expect(problems.map((p) => p.key)).toContain("keys");
  });
});

describe("[keys.labels]", () => {
  it("keeps valid sequences with their label, as written", () => {
    const { values, problems } = prefsOf({
      labels: { "<leader> f": "file", "g g": "top" },
    });
    expect(problems).toEqual([]);
    expect(values.keysLabels).toEqual({
      "<leader> f": "file",
      "g g": "top",
    });
  });

  it("drops bad entries with a problem naming the path", () => {
    const { values, problems } = prefsOf({
      labels: { "<leader> f": "file", "Nope+x": "bad", "g h": 3, "g j": "" },
    });
    expect(values.keysLabels).toEqual({ "<leader> f": "file" });
    expect(problems.map((p) => p.key)).toEqual([
      "keys.labels.Nope+x",
      "keys.labels.g h",
      "keys.labels.g j",
    ]);
  });

  it("reports a non-table labels and does not call it unknown", () => {
    const { values, problems } = prefsOf({ labels: ["x"] });
    expect(values.keysLabels).toEqual({});
    expect(problems.map((p) => p.key)).toEqual(["keys.labels"]);
    expect(prefsOf({ labels: {} }).problems).toEqual([]);
  });
});

describe("[keys] round trip", () => {
  it("emits one change per changed option and per changed label", () => {
    const next = {
      ...DEFAULT_PREFERENCES,
      keysLeader: "Space",
      keysWhichKeyPosition: "center" as const,
      keysLabels: { "<leader> f": "file" },
    };
    expect(preferencesToConfigChanges(DEFAULT_PREFERENCES, next)).toEqual([
      { key: "keys.leader", value: "Space" },
      { key: "keys.which_key_position", value: "center" },
      { key: "keys.labels.<leader> f", value: "file" },
    ]);
    expect(preferencesToConfigChanges(next, next)).toEqual([]);
  });

  it("labels: set, rename and remove become keys.labels.<seq> changes", () => {
    const base = {
      ...DEFAULT_PREFERENCES,
      keysLabels: { "g g": "top", "<leader> f": "file" },
    };
    const next = {
      ...base,
      keysLabels: { "<leader> f": "files", "g h": "home" },
    };
    expect(preferencesToConfigChanges(base, next)).toEqual([
      { key: "keys.labels.g g", value: null },
      { key: "keys.labels.<leader> f", value: "files" },
      { key: "keys.labels.g h", value: "home" },
    ]);
  });

  it("prefs -> changes -> config -> prefs", () => {
    const next = {
      ...DEFAULT_PREFERENCES,
      keysLeader: "Space",
      keysTimeoutMs: 0,
      keysCancelAfterMs: 0,
      keysWhichKey: false,
      keysWhichKeyDelayMs: 50,
      keysWhichKeyPosition: "center" as const,
    };
    const keys: Record<string, unknown> = {};
    for (const { key, value } of preferencesToConfigChanges(
      DEFAULT_PREFERENCES,
      next,
    )) {
      keys[key.slice("keys.".length)] = value;
    }
    const { values, problems } = prefsOf(keys);
    expect(problems).toEqual([]);
    for (const field of KEYS_FIELDS) {
      expect(values[field]).toBe(next[field]);
    }
  });

  it("has a mapping row per scalar field", () => {
    const rows = CONFIG_MAPPING.filter((m) => m.key.startsWith("keys."));
    expect(rows.map((r) => r.field).sort()).toEqual([...KEYS_FIELDS].sort());
  });

  it("normalizes stored preferences: bad fields default", () => {
    const prefs = normalizeKeysPreferences({
      keysLeader: "g g",
      keysTimeoutMs: 5,
      keysLabels: { a: "x", b: 1 },
    });
    expect(prefs.keysLeader).toBe("Backslash");
    expect(prefs.keysTimeoutMs).toBe(5);
    expect(prefs.keysLabels).toEqual({ a: "x" });
  });
});

describe("useKeyOptions and live reload", () => {
  const command = (id: string): CommandDefinition =>
    ({ id, title: id, keys: {}, when: [] } as unknown as CommandDefinition);
  const trieKeys = (leader: string) => [
    ...(buildKeyTrie(
      [command("file.x")],
      { "file.x": ["<leader> f"] },
      { leader },
      "mac",
    )?.keys() ?? []),
  ];

  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    disposeSettings();
    window.localStorage.clear();
  });

  it("follows the preferences store; the leader changes the trie", () => {
    const { result } = renderHook(() => useKeyOptions(window));
    expect(result.current).toEqual(DEFAULT_KEY_SETTINGS);
    expect(trieKeys(result.current.leader)).toEqual(["Backslash"]);

    act(() => {
      updatePreferences({ keysLeader: "Space", keysTimeoutMs: 10 }, window);
    });
    expect(result.current.leader).toBe("Space");
    expect(result.current.timeoutMs).toBe(10);
    expect(trieKeys(result.current.leader)).toEqual(["Space"]);
  });

  it("keeps the same object for unrelated preference changes", () => {
    const { result } = renderHook(() => useKeyOptions(window));
    const before = result.current;
    act(() => {
      updatePreferences({ zoom: 120 }, window);
    });
    expect(result.current).toBe(before);
  });

  it("a hand edit of config.toml reloads the options and labels", async () => {
    const config: Record<string, unknown> = {};
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === "load_settings") {
        return {
          configDir: "/c",
          configPath: "/c/config.toml",
          statePath: "/s/state.json",
          config: JSON.parse(JSON.stringify(config)),
          configError: null,
          state: {},
        } as LoadSettingsResult;
      }
      return undefined;
    });
    await initSettings(window, {
      tauri: true,
      invoke: invoke as never,
      listen: (async () => () => undefined) as never,
    });
    const { result } = renderHook(() => useKeyOptions(window));
    expect(result.current.leader).toBe("Backslash");

    config.keys = { leader: "Space", labels: { "<leader> f": "file" } };
    await act(async () => {
      await reloadSettings();
    });
    expect(getPreferences(window).keysLeader).toBe("Space");
    expect(result.current.leader).toBe("Space");
    expect(result.current.labels).toEqual({ "<leader> f": "file" });

    delete config.keys;
    await act(async () => {
      await reloadSettings();
    });
    expect(result.current).toEqual(DEFAULT_KEY_SETTINGS);
  });
});

describe("Settings writes [keys.labels]", () => {
  afterEach(() => {
    disposeSettings();
    window.localStorage.clear();
  });

  it("sends one keys.labels.<sequence> change per edited label to update_config", async () => {
    const calls: Array<{ cmd: string; args: unknown }> = [];
    const invoke = vi.fn(async (cmd: string, args?: unknown) => {
      calls.push({ cmd, args });
      if (cmd === "load_settings") {
        return {
          configDir: "/c",
          configPath: "/c/config.toml",
          statePath: "/s/state.json",
          config: { keys: { labels: { "g g": "top" } } },
          configError: null,
          state: {},
        } as LoadSettingsResult;
      }
      return undefined;
    });
    await initSettings(window, {
      tauri: true,
      invoke: invoke as never,
      listen: (async () => () => undefined) as never,
    });
    expect(getPreferences(window).keysLabels).toEqual({ "g g": "top" });
    act(() => {
      updatePreferences(
        { keysLabels: { "<leader> f f": "find file" } },
        window,
      );
    });
    await vi.waitFor(() =>
      expect(calls.some((c) => c.cmd === "update_config")).toBe(true),
    );
    const update = calls.find((c) => c.cmd === "update_config");
    expect((update?.args as { changes: unknown }).changes).toEqual([
      { key: "keys.labels.g g", value: null },
      { key: "keys.labels.<leader> f f", value: "find file" },
    ]);
  });
});

describe("checkKeyLabel", () => {
  it("accepts a sequence and a name, trimmed", () => {
    expect(checkKeyLabel("  <leader>   f ", " file ")).toEqual({
      sequence: "<leader> f",
      text: "file",
    });
  });
  it("refuses a bad sequence, an empty name and a long name", () => {
    expect(checkKeyLabel("Nope+x", "a")).toHaveProperty("error");
    expect(checkKeyLabel("", "a")).toHaveProperty("error");
    expect(checkKeyLabel("g g", "  ")).toHaveProperty("error");
    expect(checkKeyLabel("g g", "x".repeat(81))).toHaveProperty("error");
  });
});

describe("sameKeySequence", () => {
  it("treats spellings of one sequence as the same", () => {
    expect(sameKeySequence("g g", "G G")).toBe(true);
    expect(sameKeySequence("<leader> f", "<leader>  F")).toBe(true);
    expect(sameKeySequence("g g", "g h")).toBe(false);
    expect(sameKeySequence("g g", "Nope+x")).toBe(false);
  });
});
