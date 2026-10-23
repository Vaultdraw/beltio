import { describe, expect, it, vi } from "vitest";

import {
  buildKnownIndex,
  editDistance,
  findUnknownKeys,
  unknownKeyMessage,
} from "../vault/configKeys";
import {
  CONFIG_MAPPING,
  configToPreferences,
  unknownKeyProblems,
} from "../vault/settingsSync";

const known = buildKnownIndex([
  "interface.zoom",
  "tabs.enabled",
  "tools.arrow",
]);

describe("unknown config keys", () => {
  it("edit distance, capped", () => {
    expect(editDistance("zom", "zoom", 2)).toBe(1);
    expect(editDistance("kitten", "sitting", 3)).toBe(3);
    expect(editDistance("a", "abcdefg", 2)).toBe(3);
  });

  it("finds unknown keys and tables with suggestions", () => {
    expect(
      findUnknownKeys(
        {
          interface: { zoom: 100, zom: 1 },
          tab: { enabled: true },
          tools: { arow: {}, arrow: {} },
          stray: 1,
        },
        known,
      ),
    ).toEqual([
      { key: "interface.zom", suggestion: "interface.zoom" },
      { key: "tab", suggestion: "tabs" },
      { key: "tools.arow", suggestion: "tools.arrow" },
      { key: "stray", suggestion: null },
    ]);
  });

  it("skips the open tables and flags a known table that is not a table", () => {
    expect(
      findUnknownKeys(
        { hotkeys: { "my.cmd": ["Mod+K"] }, plugin: { x: { a: 1 } }, tabs: 1 },
        known,
      ),
    ).toEqual([{ key: "tabs", suggestion: null, notTable: true }]);
  });

  it("messages name the key and the suggestion", () => {
    expect(
      unknownKeyMessage({ key: "interface.zom", suggestion: "interface.zoom" }),
    ).toBe(
      "config.toml: unknown key interface.zom (ignored; did you mean interface.zoom?)",
    );
    expect(unknownKeyMessage({ key: "stray", suggestion: null })).toBe(
      "config.toml: unknown key stray (ignored)",
    );
    expect(
      unknownKeyMessage({ key: "tabs", suggestion: null, notTable: true }),
    ).toBe("config.toml: tabs must be a table like [tabs] (ignored)");
  });

  it("every mapped key is known", () => {
    const config: Record<string, Record<string, unknown>> = {};
    for (const { key } of CONFIG_MAPPING) {
      const [table, name] = key.split(".");
      (config[table] ??= {})[name] = 1;
    }
    expect(unknownKeyProblems(config)).toEqual([]);
  });

  it("an unknown key is a warning; the rest of the config still applies", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { values, problems } = configToPreferences({
      interface: { zoom: 120, zom: 90 },
    });
    expect(values.zoom).toBe(120);
    expect(problems).toEqual([
      {
        kind: "unknown",
        key: "interface.zom",
        message:
          "config.toml: unknown key interface.zom (ignored; did you mean interface.zoom?)",
      },
    ]);
    warn.mockRestore();
  });

  it("checking a large config is cheap", () => {
    const config: Record<string, Record<string, unknown>> = {};
    for (const { key } of CONFIG_MAPPING) {
      const [table, name] = key.split(".");
      (config[table] ??= {})[name] = 1;
    }
    unknownKeyProblems(config);
    const runs = 200;
    const t0 = performance.now();
    for (let i = 0; i < runs; i++) {
      unknownKeyProblems(config);
    }
    const perRun = (performance.now() - t0) / runs;
    // Budget 0.1 ms per check (every known key, none unknown); 5x headroom
    // for a loaded CI machine.
    expect(perRun).toBeLessThan(0.5);
  });
});
