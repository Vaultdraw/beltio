import { describe, expect, it } from "vitest";

import { configToPreferences } from "../vault/settingsSync";

import {
  allPresets,
  BUILTIN_PRESETS,
  normalizeLayoutPreferences,
  presetsProblem,
  shownParts,
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

  it("reports a bad preset and keeps the defaults", () => {
    const { values, problems } = configToPreferences({
      layout: { presets: { reading: { navigatr: false } } },
    });
    expect(values.layoutPresets).toEqual({});
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain(
      "layout.presets.reading.navigatr is not a part",
    );
  });

  it("explains every kind of bad presets table", () => {
    expect(presetsProblem(1)).toContain("a table");
    expect(presetsProblem({ "a b": {} })).toContain("preset names");
    expect(presetsProblem({ a: 1 })).toContain("must be a table");
    expect(presetsProblem({ a: { header: "no" } })).toContain("true or false");
    expect(presetsProblem({ a: { header: false } })).toBeNull();
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
    });
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
