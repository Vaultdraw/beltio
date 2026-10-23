import { describe, expect, it } from "vitest";

import {
  DEFAULT_PREFERENCES,
  normalizePreferences,
} from "../vault/preferences";

import {
  SERVICES_DEFAULTS,
  SERVICES_FIELDS,
  SERVICES_MAPPINGS,
  isStartMode,
  normalizeServicesPreferences,
} from "./servicesSettings";
import { SERVICES_SETTINGS_SCHEMA } from "./servicesSettingsSchema";

const KEYS = {
  searchStart: "search.start",
  linksStart: "links.start",
  historyStart: "history.start",
} as const;

describe("servicesSettings", () => {
  it("defaults are idle / idle / open", () => {
    expect(SERVICES_DEFAULTS).toEqual({
      searchStart: "idle",
      linksStart: "idle",
      historyStart: "open",
    });
    expect(DEFAULT_PREFERENCES.searchStart).toBe("idle");
    expect(DEFAULT_PREFERENCES.historyStart).toBe("open");
  });

  it("isStartMode accepts exactly open, idle, use", () => {
    for (const ok of ["open", "idle", "use"]) {
      expect(isStartMode(ok)).toBe(true);
    }
    for (const bad of ["Open", "lazy", "", null, undefined, 1, true, {}]) {
      expect(isStartMode(bad)).toBe(false);
    }
  });

  it("mappings cover every field with the documented keys and validate values", () => {
    expect(SERVICES_MAPPINGS.map((m) => [m.field, m.key])).toEqual(
      SERVICES_FIELDS.map((f) => [f, KEYS[f]]),
    );
    for (const m of SERVICES_MAPPINGS) {
      expect(m.valid("use")).toBe(true);
      expect(m.valid("never")).toBe(false);
      expect(m.valid(true)).toBe(false);
    }
  });

  it("normalize keeps valid values and defaults bad or missing ones", () => {
    expect(
      normalizeServicesPreferences({
        searchStart: "use",
        linksStart: "bogus",
        historyStart: 3,
      }),
    ).toEqual({ searchStart: "use", linksStart: "idle", historyStart: "open" });
    expect(normalizeServicesPreferences({})).toEqual(SERVICES_DEFAULTS);
  });

  it("normalizePreferences carries the fields through", () => {
    expect(normalizePreferences({ searchStart: "use" }).searchStart).toBe(
      "use",
    );
    expect(normalizePreferences({ historyStart: "x" }).historyStart).toBe(
      "open",
    );
  });

  it("schema rows' config keys equal the mapping keys, on the General page", () => {
    expect(SERVICES_SETTINGS_SCHEMA.map((r) => r.configKey)).toEqual(
      SERVICES_MAPPINGS.map((m) => m.key),
    );
    for (const r of SERVICES_SETTINGS_SCHEMA) {
      expect(r.page).toBe("general");
    }
    expect(SERVICES_SETTINGS_SCHEMA[0].heading).toBe("Startup");
  });
});
