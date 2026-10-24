import { describe, expect, it } from "vitest";

import { DEFAULT_PREFERENCES } from "../vault/preferences";
import {
  configToPreferences,
  preferencesToConfigChanges,
} from "../vault/settingsSync";

describe("[plugins] importers", () => {
  it("defaults to an empty table", () => {
    expect(configToPreferences({}).values.pluginImporters).toEqual({});
  });

  it('reads a table of extension to plugin id, with "" for off', () => {
    const r = configToPreferences({
      plugins: { importers: { txt: "text-import", md: "" } },
    });
    expect(r.values.pluginImporters).toEqual({ txt: "text-import", md: "" });
    expect(r.problems).toEqual([]);
  });

  it("rejects a non-table or non-string values with a problem", () => {
    for (const importers of ["txt", ["a"], { txt: 1 }]) {
      const r = configToPreferences({ plugins: { importers } });
      expect(r.values.pluginImporters).toEqual({});
      expect(r.problems.map((p) => p.key)).toEqual(["plugins.importers"]);
    }
  });

  it("round-trips to a config change", () => {
    const next = { ...DEFAULT_PREFERENCES, pluginImporters: { txt: "a-b" } };
    expect(
      preferencesToConfigChanges(DEFAULT_PREFERENCES, next),
    ).toContainEqual({ key: "plugins.importers", value: { txt: "a-b" } });
  });
});
