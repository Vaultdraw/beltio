import { describe, expect, it } from "vitest";

import {
  HISTORY_DEFAULTS,
  HISTORY_FIELDS,
  HISTORY_LIMITS,
  HISTORY_MAPPINGS,
  normalizeHistoryPreferences,
  toHistorySettings,
} from "../history/historySettings";
import {
  DEFAULT_PREFERENCES,
  normalizePreferences,
} from "../vault/preferences";
import {
  CONFIG_MAPPING,
  configToPreferences,
  preferencesToConfigChanges,
} from "../vault/settingsSync";
import {
  parseVaultSettings,
  PER_VAULT_FIELDS,
  resolveSettings,
} from "../vault/vaultSettings";

const KEYS = {
  historyEnabled: "history.enabled",
  historyIntervalMinutes: "history.interval_minutes",
  historyKeepAllHours: "history.keep_all_hours",
  historyKeepHourlyHours: "history.keep_hourly_hours",
  historyKeepDailyDays: "history.keep_daily_days",
  historyKeepWeeklyWeeks: "history.keep_weekly_weeks",
  historySizeCapMb: "history.size_cap_mb",
  historyHighlightChanges: "history.highlight_changes",
} as const;

describe("history settings defaults", () => {
  it("match the plan", () => {
    expect(HISTORY_DEFAULTS).toEqual({
      historyEnabled: true,
      historyIntervalMinutes: 5,
      historyKeepAllHours: 1,
      historyKeepHourlyHours: 24,
      historyKeepDailyDays: 30,
      historyKeepWeeklyWeeks: 0,
      historySizeCapMb: 500,
      historyHighlightChanges: true,
    });
    for (const field of HISTORY_FIELDS) {
      expect(DEFAULT_PREFERENCES[field]).toBe(HISTORY_DEFAULTS[field]);
    }
  });

  it("converts to the IPC settings object", () => {
    expect(toHistorySettings(HISTORY_DEFAULTS)).toEqual({
      enabled: true,
      intervalMinutes: 5,
      keepAllHours: 1,
      keepHourlyHours: 24,
      keepDailyDays: 30,
      keepWeeklyWeeks: 0,
      sizeCapMb: 500,
      highlightChanges: true,
    });
  });
});

describe("config.toml mapping", () => {
  it("maps every field to its [history] key, once", () => {
    // history.start belongs to the services settings (when history starts).
    const rows = CONFIG_MAPPING.filter(
      (m) => m.key.startsWith("history.") && m.key !== "history.start",
    );
    expect(rows).toHaveLength(HISTORY_FIELDS.length);
    expect(HISTORY_MAPPINGS.map((m) => [m.field, m.key])).toEqual(
      HISTORY_FIELDS.map((f) => [f, KEYS[f]]),
    );
  });

  it("reads valid values and defaults missing ones", () => {
    const { values, problems } = configToPreferences({
      history: { enabled: false, interval_minutes: 0, size_cap_mb: 0 },
    });
    expect(problems).toEqual([]);
    expect(values.historyEnabled).toBe(false);
    expect(values.historyIntervalMinutes).toBe(0);
    expect(values.historySizeCapMb).toBe(0);
    expect(values.historyKeepDailyDays).toBe(30);
  });

  it.each([
    ["enabled", "yes"],
    ["interval_minutes", -1],
    ["interval_minutes", 1441],
    ["interval_minutes", 2.5],
    ["keep_all_hours", "1"],
    ["keep_weekly_weeks", 5201],
    ["size_cap_mb", 1_000_001],
    ["highlight_changes", 1],
  ])("rejects history.%s = %j with a problem and the default", (name, bad) => {
    const { values, problems } = configToPreferences({
      history: { [name]: bad },
    });
    const key = `history.${name}`;
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain(key);
    const field = HISTORY_FIELDS.find((f) => KEYS[f] === key)!;
    expect(values[field]).toBe(HISTORY_DEFAULTS[field]);
  });

  it("accepts the range edges", () => {
    const edges = Object.fromEntries(
      (Object.keys(HISTORY_LIMITS) as Array<keyof typeof HISTORY_LIMITS>).map(
        (f) => [KEYS[f].slice("history.".length), HISTORY_LIMITS[f].max],
      ),
    );
    const { values, problems } = configToPreferences({ history: edges });
    expect(problems).toEqual([]);
    expect(values.historySizeCapMb).toBe(HISTORY_LIMITS.historySizeCapMb.max);
  });

  it("writes only changed history keys", () => {
    const changes = preferencesToConfigChanges(DEFAULT_PREFERENCES, {
      ...DEFAULT_PREFERENCES,
      historyIntervalMinutes: 10,
      historyEnabled: false,
    });
    expect(changes).toEqual([
      { key: "history.enabled", value: false },
      { key: "history.interval_minutes", value: 10 },
    ]);
  });
});

describe("stored preferences", () => {
  it("normalizes bad stored values to defaults", () => {
    expect(
      normalizeHistoryPreferences({
        historyEnabled: "no",
        historyIntervalMinutes: 7,
        historySizeCapMb: -3,
      }),
    ).toEqual({ ...HISTORY_DEFAULTS, historyIntervalMinutes: 7 });
    expect(
      normalizePreferences({ historyKeepDailyDays: 12 }).historyKeepDailyDays,
    ).toBe(12);
  });
});

describe("per-vault settings", () => {
  it("lists every history field as per-vault capable", () => {
    for (const field of HISTORY_FIELDS) {
      expect(PER_VAULT_FIELDS).toContain(field);
    }
  });

  it("parses [history] from settings.toml, ignoring invalid values", () => {
    const { overrides, problems } = parseVaultSettings({
      history: { enabled: false, interval_minutes: 99999, size_cap_mb: 50 },
    });
    expect(overrides).toEqual({ historyEnabled: false, historySizeCapMb: 50 });
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain("history.interval_minutes");
  });

  it("vault value beats the global one (kill switch per vault)", () => {
    const effective = resolveSettings(
      { historyEnabled: false, historyIntervalMinutes: 0 },
      { ...DEFAULT_PREFERENCES, historyIntervalMinutes: 15 },
    );
    expect(effective.historyEnabled).toBe(false);
    expect(effective.historyIntervalMinutes).toBe(0);
    expect(effective.historyKeepAllHours).toBe(1);
    expect(toHistorySettings(effective).enabled).toBe(false);
  });
});
