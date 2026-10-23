import { describe, expect, it } from "vitest";

import { normalizePreferences } from "../vault/preferences";
import {
  CONFIG_MAPPING,
  configToPreferences,
  preferencesToConfigChanges,
} from "../vault/settingsSync";

import {
  MEMORY_DEFAULTS,
  MEMORY_FIELDS,
  normalizeMemoryPreferences,
} from "./memorySettings";
import { MEMORY_SETTINGS_SCHEMA } from "./memorySettingsSchema";

describe("memory settings", () => {
  it("defaults: free unused images on, 1000 undo steps", () => {
    expect(MEMORY_DEFAULTS).toEqual({
      memoryFreeUnusedImages: true,
      memoryUndoSteps: 1000,
    });
    const { values, problems } = configToPreferences({});
    expect(problems).toEqual([]);
    for (const f of MEMORY_FIELDS) {
      expect(values[f]).toBe(MEMORY_DEFAULTS[f]);
    }
  });

  it("reads both keys from config.toml", () => {
    const { values, problems } = configToPreferences({
      memory: { free_unused_images: false, undo_steps: 200 },
    });
    expect(problems).toEqual([]);
    expect(values.memoryFreeUnusedImages).toBe(false);
    expect(values.memoryUndoSteps).toBe(200);
  });

  it.each([
    ["free_unused_images", "yes"],
    ["free_unused_images", 1],
    ["undo_steps", 9],
    ["undo_steps", 10001],
    ["undo_steps", 12.5],
    ["undo_steps", "100"],
  ])("rejects memory.%s = %j with a problem and the default", (name, bad) => {
    const { values, problems } = configToPreferences({
      memory: { [name]: bad },
    });
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain(`memory.${name}`);
    expect(values.memoryFreeUnusedImages).toBe(true);
    expect(values.memoryUndoSteps).toBe(1000);
  });

  it("accepts the range edges", () => {
    for (const v of [10, 10000]) {
      const { values, problems } = configToPreferences({
        memory: { undo_steps: v },
      });
      expect(problems).toEqual([]);
      expect(values.memoryUndoSteps).toBe(v);
    }
  });

  it("writes changed values back as config changes", () => {
    const prev = normalizePreferences({});
    const changes = preferencesToConfigChanges(prev, {
      ...prev,
      memoryUndoSteps: 300,
    });
    expect(changes).toContainEqual({ key: "memory.undo_steps", value: 300 });
  });

  it("normalizes stored preferences", () => {
    expect(normalizeMemoryPreferences({ memoryUndoSteps: 3 })).toEqual(
      MEMORY_DEFAULTS,
    );
    expect(normalizeMemoryPreferences({ memoryUndoSteps: 50 })).toMatchObject({
      memoryUndoSteps: 50,
    });
  });

  it("every config key has a settings row, none per vault", () => {
    const keys = CONFIG_MAPPING.filter((m) => m.key.startsWith("memory.")).map(
      (m) => m.key,
    );
    expect(MEMORY_SETTINGS_SCHEMA.map((r) => r.configKey).sort()).toEqual(
      keys.sort(),
    );
    expect(MEMORY_SETTINGS_SCHEMA.every((r) => !r.perVault)).toBe(true);
  });
});
