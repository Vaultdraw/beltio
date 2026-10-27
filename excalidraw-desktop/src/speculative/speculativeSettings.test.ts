import { describe, expect, it } from "vitest";

import { normalizePreferences } from "../vault/preferences";
import {
  configToPreferences,
  preferencesToConfigChanges,
} from "../vault/settingsSync";

import { SPECULATIVE_SETTINGS_SCHEMA } from "./speculativeSettingsSchema";

describe("files.speculative_open", () => {
  it("is on by default", () => {
    const { values, problems } = configToPreferences({});
    expect(problems).toEqual([]);
    expect(values.filesSpeculativeOpen).toBe(true);
  });

  it("reads false from config.toml and rejects anything else", () => {
    expect(
      configToPreferences({ files: { speculative_open: false } }).values
        .filesSpeculativeOpen,
    ).toBe(false);
    const bad = configToPreferences({ files: { speculative_open: "no" } });
    expect(bad.problems).toHaveLength(1);
    expect(bad.problems[0].message).toContain("files.speculative_open");
    expect(bad.values.filesSpeculativeOpen).toBe(true);
  });

  it("is written back and has one global settings row", () => {
    const prev = normalizePreferences({});
    expect(
      preferencesToConfigChanges(prev, {
        ...prev,
        filesSpeculativeOpen: false,
      }),
    ).toContainEqual({ key: "files.speculative_open", value: false });
    expect(SPECULATIVE_SETTINGS_SCHEMA.map((r) => r.configKey)).toEqual([
      "files.speculative_open",
    ]);
  });
});
