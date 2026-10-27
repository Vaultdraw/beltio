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
  isWarning,
  unknownKeyProblems,
} from "../vault/settingsSync";
import { parseVaultSettings } from "../vault/vaultSettings";

const known = buildKnownIndex(
  ["interface.zoom", "tabs.enabled", "tools.arrow"],
  { "tools.arrow": ["stroke_color", "stroke_width"] },
);

describe("unknown config keys", () => {
  it("edit distance, capped", () => {
    expect(editDistance("zom", "zoom", 2)).toBe(1);
    expect(editDistance("kitten", "sitting", 3)).toBe(3);
    expect(editDistance("a", "abcdefg", 2)).toBe(3);
    expect(editDistance("srot", "sort", 1)).toBe(1);
    expect(editDistance("abcd", "badc", 1)).toBe(2);
  });

  it("finds unknown keys and tables with suggestions", () => {
    expect(
      findUnknownKeys(
        {
          interface: { zoom: 100, zom: 1 },
          tab: { enabled: true },
          tools: { arow: {}, arrow: { stroke_width: 3, stroke_colour: "red" } },
          stray: 1,
        },
        known,
      ),
    ).toEqual([
      { key: "interface.zom", suggestion: "interface.zoom" },
      { key: "tab", suggestion: "tabs" },
      { key: "tools.arow", suggestion: "tools.arrow" },
      {
        key: "tools.arrow.stroke_colour",
        suggestion: "tools.arrow.stroke_color",
      },
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
      unknownKeyMessage({ key: "stray", suggestion: null }, "settings.toml"),
    ).toBe("settings.toml: unknown key stray (ignored)");
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

  // Regression (review 1): a typo inside [tools.<tool>] used to reset the
  // whole tool table, losing its valid keys.
  it("a typo inside a tool table drops only that key", () => {
    const { values, problems } = configToPreferences({
      tools: { arrow: { stroke_width: 3, stroke_colour: "#f00" } },
    });
    expect(values.toolArrow).toEqual({ stroke_width: 3 });
    expect(problems).toEqual([
      {
        kind: "unknown",
        key: "tools.arrow.stroke_colour",
        message:
          "config.toml: unknown key tools.arrow.stroke_colour (ignored; did you mean tools.arrow.stroke_color?)",
      },
    ]);
  });

  // Regression (review 2): a vault's settings.toml had no unknown-key check.
  it("settings.toml reports unknown keys, scoped to the per-vault keys", () => {
    const { overrides, problems } = parseVaultSettings({
      navigator: { sort: "name_desc", srot: "x" },
      interface: { zoom: 120 },
      tools: { arrow: { stroke_width: 3, stroke_colour: "#f00" } },
      graph: { show_orphans: false },
      plugin: { "my-plugin": { a: 1 } },
    });
    expect(overrides.navigatorSort).toBe("name_desc");
    expect(overrides.toolArrow).toEqual({ stroke_width: 3 });
    expect(problems.map((p) => [p.kind, p.message])).toEqual([
      [
        "unknown",
        "settings.toml: unknown key navigator.srot (ignored; did you mean navigator.sort?)",
      ],
      ["unknown", "settings.toml: unknown key interface.zoom (ignored)"],
      [
        "unknown",
        "settings.toml: unknown key tools.arrow.stroke_colour (ignored; did you mean tools.arrow.stroke_color?)",
      ],
    ]);
  });

  // Regression (review 3): unknown keys are warnings, the rest are errors.
  it("only unknown keys are warnings", () => {
    expect(isWarning({ kind: "unknown", message: "m" })).toBe(true);
    for (const kind of ["parse", "invalid", "io"] as const) {
      expect(isWarning({ kind, message: "m" })).toBe(false);
    }
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

describe("[keys.labels]", () => {
  it("is not reported as unknown", async () => {
    const { unknownKeyProblems } = await import("../vault/settingsSync");
    expect(
      unknownKeyProblems({
        keys: { leader: "Space", labels: { "g g": "top" } },
      }),
    ).toEqual([]);
  });
});

describe("[control]", () => {
  it("is not reported as unknown (the native side reads it)", async () => {
    const { unknownKeyProblems } = await import("../vault/settingsSync");
    expect(
      unknownKeyProblems({
        control: {
          enabled: true,
          uri_enabled: true,
          uri_allow: ["new"],
          notify_edits: false,
        },
      }),
    ).toEqual([]);
  });
});

describe("[watchdog]", () => {
  it("is a known table with both keys", async () => {
    const { unknownKeyProblems } = await import("../vault/settingsSync");
    expect(
      unknownKeyProblems({ watchdog: { enabled: true, grace_ms: 5000 } }),
    ).toEqual([]);
    expect(
      unknownKeyProblems({ watchdog: { nope: 1 } }).map((p) => p.key),
    ).toEqual(["watchdog.nope"]);
  });
});

describe("[window]", () => {
  it("is a known table with decorations", async () => {
    const { unknownKeyProblems } = await import("../vault/settingsSync");
    expect(unknownKeyProblems({ window: { decorations: "native" } })).toEqual(
      [],
    );
    expect(
      unknownKeyProblems({ window: { nope: 1 } }).map((p) => p.key),
    ).toEqual(["window.nope"]);
  });
});
