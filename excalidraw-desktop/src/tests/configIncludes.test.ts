import { afterEach, describe, expect, it, vi } from "vitest";

import { keySource, layerFileName, sourceFileOf } from "../vault/configSources";
import { getPreferences } from "../vault/preferences";
import {
  disposeSettings,
  getSettingsStatus,
  initSettings,
  isWarning,
  reloadSettings,
  type LayerPayload,
  type LoadSettingsResult,
} from "../vault/settingsSync";

const base = (
  id: number,
  kind: LayerPayload["kind"],
  path: string,
  config: Record<string, unknown> | null,
  extra: Partial<LayerPayload> = {},
): LayerPayload => ({
  id,
  kind,
  name: path.split("/").pop(),
  path,
  status: config ? "ok" : "missing",
  error: null,
  config,
  ...extra,
});
const inc = (
  id: number,
  name: string,
  config: Record<string, unknown> | null,
) => base(id, "include", `/dots/${name}`, config, { from: "/x/config.toml" });
const cfg = (config: Record<string, unknown> | null) =>
  base(0, "config", "/x/config.toml", config);
const over = (config: Record<string, unknown> | null) =>
  base(1, "overrides", "/s/overrides.toml", config);

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

describe("keySource with included files", () => {
  const colors = inc(2, "colors.toml", {
    editor: { font_size: 30, roughness: 1 },
  });

  it("names the included file a value comes from, with its path", () => {
    const found = keySource([colors, cfg({}), over(null)], "editor.font_size");
    expect(found).toEqual({
      source: "colors.toml",
      path: "/dots/colors.toml",
      value: 30,
    });
  });

  it("config.toml hides the include and the chip data names both", () => {
    const found = keySource(
      [colors, cfg({ editor: { font_size: 14 } }), over(null)],
      "editor.font_size",
    );
    expect(found.source).toBe("config.toml");
    expect(found.hidden).toEqual({ file: "colors.toml", value: 30 });
  });

  it("overrides win over an include, and a later include wins over an earlier", () => {
    const later = inc(3, "later.toml", { editor: { font_size: 40 } });
    expect(
      keySource([colors, later, cfg({}), over(null)], "editor.font_size")
        .source,
    ).toBe("later.toml");
    const found = keySource(
      [colors, cfg({}), over({ editor: { font_size: 20 } })],
      "editor.font_size",
    );
    expect(found.source).toBe("overrides.toml");
    expect(found.hidden).toEqual({ file: "colors.toml", value: 30 });
  });

  it("a skipped include sets nothing, and names resolve for messages", () => {
    const bad = base(2, "include", "/dots/bad.toml", null, {
      status: "error",
      error: { message: "x", line: 1 },
    });
    expect(keySource([bad, cfg({}), over(null)], "editor.font_size")).toEqual({
      source: "default",
    });
    expect(
      sourceFileOf([colors, cfg({}), over(null)], "editor.font_size"),
    ).toBe("colors.toml");
    expect(layerFileName({ ...colors, name: undefined })).toBe("colors.toml");
    // An include called config.toml is named by its path, never mistaken for the real one.
    const clash = base(2, "include", "/dots/config.toml", { a: {} });
    expect(layerFileName(clash)).toBe("/dots/config.toml");
  });
});

describe("load with includes", () => {
  afterEach(() => disposeSettings());

  const start = async (first: LoadSettingsResult) => {
    let current = first;
    const invoke = vi.fn(async (cmd: string) =>
      cmd === "load_settings" ? current : undefined,
    );
    await initSettings(window, {
      invoke: invoke as never,
      listen: (async () => () => undefined) as never,
      tauri: true,
    });
    return { set: (next: LoadSettingsResult) => (current = next) };
  };

  it("applies an included value and reports skipped files as warnings", async () => {
    const missing = base(3, "include", "/dots/nope.toml", null, {
      status: "missing",
      error: { message: "include not found: /dots/nope.toml", line: null },
      from: "/x/config.toml",
    });
    const bad = base(4, "include", "/dots/bad.toml", null, {
      status: "error",
      error: { message: "invalid table header", line: 2 },
      from: "/x/config.toml",
    });
    await start(
      payload(
        { editor: { font_size: 33 } },
        [
          inc(2, "colors.toml", { editor: { font_size: 33 } }),
          missing,
          bad,
          cfg({}),
          over(null),
        ],
        {
          includeWarnings: [
            "include cycle: a.toml -> b.toml -> a.toml (skipped)",
          ],
        },
      ),
    );
    expect(getPreferences(window).defaultFontSize).toBe(33);
    const problems = getSettingsStatus().problems;
    expect(problems.map((p) => p.message)).toEqual([
      "include not found: /dots/nope.toml (skipped)",
      "/dots/bad.toml line 2: invalid table header (skipped)",
      "include cycle: a.toml -> b.toml -> a.toml (skipped)",
    ]);
    expect(problems.every(isWarning)).toBe(true);
  });

  it("a broken include does not freeze the reload: the rest applies", async () => {
    const h = await start(
      payload({ editor: { font_size: 12 } }, [
        cfg({ editor: { font_size: 12 } }),
        over(null),
      ]),
    );
    h.set(
      payload({ editor: { font_size: 12, roughness: 2 } }, [
        base(2, "include", "/dots/bad.toml", null, {
          status: "error",
          error: { message: "bad", line: 1 },
        }),
        cfg({ editor: { font_size: 12, roughness: 2 } }),
        over(null),
      ]),
    );
    await reloadSettings();
    expect(getPreferences(window).defaultRoughness).toBe(2);
    expect(getSettingsStatus().layers?.map((l) => l.kind)).toEqual([
      "include",
      "config",
      "overrides",
    ]);
  });

  it("unknown keys in an included file are named by that file; [include] is known", async () => {
    await start(
      payload({ include: { files: ["x.toml"] }, editr: {} }, [
        inc(2, "colors.toml", { editr: { font_size: 1 } }),
        cfg({ include: { files: ["colors.toml"] } }),
        over(null),
      ]),
    );
    const messages = getSettingsStatus().problems.map((p) => p.message);
    expect(
      messages.some((m) => m.startsWith("colors.toml: unknown key editr")),
    ).toBe(true);
    expect(messages.some((m) => m.includes("unknown key include"))).toBe(false);
  });
});
