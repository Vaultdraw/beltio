import { describe, expect, it } from "vitest";

import { normalizePreferences } from "../vault/preferences";
import { configToPreferences } from "../vault/settingsSync";

import { SYNC_DEFAULTS, normalizeSyncPreferences } from "./syncSettings";
import { SYNC_SETTINGS_SCHEMA } from "./syncSettingsSchema";

describe("sync settings", () => {
  it("defaults: badge and iCloud download on", () => {
    expect(SYNC_DEFAULTS).toEqual({
      syncConflictBadge: true,
      syncDownloadPlaceholders: true,
    });
    const { values, problems } = configToPreferences({});
    expect(problems).toEqual([]);
    expect(values.syncConflictBadge).toBe(true);
  });
  it("reads [sync] keys and reports a wrong type", () => {
    const ok = configToPreferences({
      sync: { conflict_badge: false, download_placeholders: false },
    });
    expect(ok.values.syncConflictBadge).toBe(false);
    expect(ok.values.syncDownloadPlaceholders).toBe(false);
    const bad = configToPreferences({ sync: { conflict_badge: "yes" } });
    expect(bad.problems.map((p) => p.key)).toContain("sync.conflict_badge");
    expect(bad.values.syncConflictBadge).toBe(true);
  });
  it("stored preferences fall back to defaults when invalid", () => {
    expect(normalizeSyncPreferences({ syncConflictBadge: 3 })).toEqual(
      SYNC_DEFAULTS,
    );
    expect(
      normalizePreferences({ syncConflictBadge: false }).syncConflictBadge,
    ).toBe(false);
  });
  it("each row names a [sync] key", () => {
    expect(SYNC_SETTINGS_SCHEMA.map((r) => r.configKey)).toEqual([
      "sync.conflict_badge",
      "sync.download_placeholders",
    ]);
  });
});
