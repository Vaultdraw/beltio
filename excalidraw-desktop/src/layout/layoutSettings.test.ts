import { describe, expect, it } from "vitest";

import { configToPreferences } from "../vault/settingsSync";

import {
  allPresets,
  BUILTIN_PRESETS,
  focusPreset,
  LAYOUT_DEFAULTS,
  LAYOUT_MAPPINGS,
  normalizeLayoutPreferences,
  presetsProblem,
  shownParts,
  splitPresets,
} from "./layoutSettings";
import {
  getLayoutState,
  resetLayoutState,
  setActivePreset,
  setSessionPart,
  togglePreset,
} from "./layoutStore";

const ALL = {
  header: true,
  navigator: true,
  activity_bar: true,
  tab_strip: true,
  footer: true,
  status_bar: true,
};

describe("layout settings", () => {
  it("reads [layout] keys and presets from config.toml", () => {
    const { values, problems } = configToPreferences({
      layout: {
        header: false,
        preset: "reading",
        presets: { reading: { navigator: false, footer: false } },
      },
    });
    expect(problems).toEqual([]);
    expect(values.layoutHeader).toBe(false);
    expect(values.layoutFooter).toBe(true);
    expect(values.layoutPreset).toBe("reading");
    expect(values.layoutPresets).toEqual({
      reading: { navigator: false, footer: false },
    });
  });

  it("drops only the bad preset, with a problem; the others apply", () => {
    const { values, problems } = configToPreferences({
      layout: {
        presets: { reading: { navigatr: false }, clean: { header: false } },
      },
    });
    expect(values.layoutPresets).toEqual({ clean: { header: false } });
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain(
      "layout.presets.reading.navigatr is not a part",
    );
  });

  it("explains every kind of bad preset", () => {
    expect(presetsProblem(1)).toContain("a table");
    expect(splitPresets({ "a b": {} }).problems[0]).toContain("preset names");
    expect(splitPresets({ a: 1 }).problems[0]).toContain("must be a table");
    expect(splitPresets({ a: { header: "no" } }).problems[0]).toContain(
      "true or false",
    );
    expect(splitPresets({ a: { header: false } })).toEqual({
      presets: { a: { header: false } },
      problems: [],
    });
  });

  it("accepts a [hotkeys] binding for a user preset's command", () => {
    const { values, problems } = configToPreferences({
      layout: { presets: { reading: { header: false } } },
      hotkeys: { "layout.preset.reading": ["Mod+Shift+R"] },
    });
    expect(problems).toEqual([]);
    expect(values.hotkeys["layout.preset.reading"]).toEqual(["Mod+Shift+R"]);
  });

  it("normalizes stored values", () => {
    expect(
      normalizeLayoutPreferences({ layoutHeader: "x", layoutPreset: "focus" }),
    ).toMatchObject({ layoutHeader: true, layoutPreset: "focus" });
  });

  it("keeps the built-in focus preset unless the user redefines it", () => {
    expect(allPresets({}).focus).toEqual(BUILTIN_PRESETS.focus);
    expect(allPresets({ a: { header: false } })).toHaveProperty("focus");
    expect(allPresets({ focus: { header: false } }).focus).toEqual({
      header: false,
    });
  });

  it("session toggle beats the preset, the preset beats the base", () => {
    const base = { ...ALL, tab_strip: false };
    expect(shownParts(base, null, {})).toEqual(base);
    expect(shownParts(base, { header: false }, {})).toEqual({
      ...base,
      header: false,
    });
    expect(
      shownParts(base, BUILTIN_PRESETS.focus, { navigator: true }),
    ).toEqual({
      header: false,
      navigator: true,
      activity_bar: false,
      tab_strip: false,
      footer: false,
      status_bar: false,
    });
  });

  it("[focus] hide shapes the focus preset; a user preset still wins", () => {
    expect(allPresets({}, ["navigator", "footer"]).focus).toEqual({
      navigator: false,
      footer: false,
    });
    expect(allPresets({ focus: { header: false } }, ["footer"]).focus).toEqual({
      header: false,
    });
    expect(focusPreset([])).toEqual({});
  });

  it("reads [focus] from config.toml", () => {
    const { values: preferences } = configToPreferences({
      focus: { hide: ["navigator"], remember: true, hint: true },
    });
    expect(preferences).toMatchObject({
      focusHide: ["navigator"],
      focusRemember: true,
      focusHint: true,
    });
  });

  it("validates focus.hide as a list of part names", () => {
    const hide = LAYOUT_MAPPINGS.find((m) => m.key === "focus.hide")!;
    expect(hide.valid(["header", "status_bar"])).toBe(true);
    expect(hide.valid([])).toBe(true);
    expect(hide.valid(["canvas"])).toBe(false);
    expect(hide.valid("header")).toBe(false);
    expect(normalizeLayoutPreferences({ focusHide: ["x"] }).focusHide).toEqual(
      LAYOUT_DEFAULTS.focusHide,
    );
  });
});

describe("layout store", () => {
  it("toggles a preset and drops hand toggles on every switch", () => {
    resetLayoutState();
    togglePreset("focus");
    expect(getLayoutState().preset).toBe("focus");
    setSessionPart("navigator", true);
    expect(getLayoutState().session).toEqual({ navigator: true });
    togglePreset("focus");
    expect(getLayoutState()).toEqual({ preset: null, session: {} });
    setActivePreset("reading");
    expect(getLayoutState().preset).toBe("reading");
    resetLayoutState();
  });
});

describe("[layout] narrow_width (hunter A-7)", () => {
  it("accepts whole pixels from 0 to 4000 and defaults to 600 (a 280 px list plus 320 px of drawing)", async () => {
    const { LAYOUT_MAPPINGS, LAYOUT_DEFAULTS } = await import(
      "./layoutSettings"
    );
    const m = LAYOUT_MAPPINGS.find((x) => x.key === "layout.narrow_width")!;
    expect(LAYOUT_DEFAULTS.layoutNarrowWidth).toBe(600);
    for (const ok of [0, 600, 4000]) {
      expect(m.valid(ok)).toBe(true);
    }
    for (const bad of [-1, 4001, 600.5, "600", null]) {
      expect(m.valid(bad)).toBe(false);
    }
  });

  it("a narrow window folds the file list under any preset, and a preset can still show it", async () => {
    const { narrowLayer } = await import("./useLayout");
    const { shownParts } = await import("./layoutSettings");
    const base = {
      header: true,
      footer: true,
      navigator: true,
      activity_bar: true,
      tab_strip: true,
      status_bar: true,
    };
    expect(shownParts(base, narrowLayer(true, null), {}).navigator).toBe(false);
    expect(shownParts(base, narrowLayer(false, null), {}).navigator).toBe(true);
    // The overlay is a view state of the narrow window: open shows it, wide ignores it.
    expect(shownParts(base, narrowLayer(true, null, true), {}).navigator).toBe(
      true,
    );
    expect(shownParts(base, narrowLayer(false, null, true), {}).navigator).toBe(
      true,
    );
    expect(
      shownParts(base, narrowLayer(true, { navigator: true }), {}).navigator,
    ).toBe(true);
    // Toggle navigator in a narrow window is a session choice
    expect(
      shownParts(base, narrowLayer(true, null), { navigator: true }).navigator,
    ).toBe(true);
  });
});
