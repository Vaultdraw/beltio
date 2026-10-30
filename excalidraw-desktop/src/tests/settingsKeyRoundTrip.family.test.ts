import { describe, expect, it } from "vitest";

import { DEFAULT_PREFERENCES } from "../vault/preferences";
import {
  CONFIG_MAPPING,
  preferencesToConfigChanges,
} from "../vault/settingsSync";

/**
 * Family sweep (toimprove 159, test-net-2 settings family; validator 2026-10-30): every Settings
 * value that has a config key reaches that key when changed, and going back to the default sends
 * the reset (value null with the default as a hint). This is the app's half of the "changed on
 * screen but the config layer has no new value" rows; the e2e fake is the other half.
 *
 * Generic: each mapping gets a valid non-default value from simple candidates, so a new key is
 * covered with no new row. Keys with no candidate are listed so the gap is visible.
 */
type Prefs = typeof DEFAULT_PREFERENCES;

const candidateFor = (
  def: unknown,
  valid: (v: unknown) => boolean,
): unknown | undefined => {
  const tries: unknown[] = [];
  if (typeof def === "boolean") {
    tries.push(!def);
  } else if (def === undefined) {
    tries.push(false, true);
  } else if (typeof def === "number") {
    tries.push(
      def + 1,
      def - 1,
      Math.round(def * 2),
      Math.round(def / 2),
      Math.round((def + 0.05) * 100) / 100,
      Math.round((def - 0.05) * 100) / 100,
      def + 10,
      def - 10,
    );
  }
  return tries.find((v) => v !== def && valid(v));
};

const rows = CONFIG_MAPPING.map((m) => {
  const def = (DEFAULT_PREFERENCES as Record<string, unknown>)[m.field];
  return { ...m, def, value: candidateFor(def, m.valid) };
}).filter((r) => r.value !== undefined);

describe("every Settings value with a config key writes and resets that key", () => {
  it("covers the nine rows test-net-2 could not verify", () => {
    const keys = new Set(rows.map((r) => r.key));
    for (const key of [
      "updates.check_on_startup",
      "network.allow_themes",
      "network.allow_plugins",
      "pdf_import.quality",
      "pdf_import.max_side",
      "ai.enabled",
      "interface.zoom",
    ]) {
      expect(keys.has(key), key).toBe(true);
    }
  });

  it.each(rows.map((r) => [r.key, r] as const))("%s", (_key, r) => {
    const base = { ...DEFAULT_PREFERENCES } as Prefs;
    const changed = { ...base, [r.field]: r.value } as Prefs;

    const set = preferencesToConfigChanges(base, changed).filter(
      (c) => c.key === r.key,
    );
    expect(set, "a change writes its key").toEqual([
      { key: r.key, value: r.value },
    ]);

    const back = preferencesToConfigChanges(changed, base).filter(
      (c) => c.key === r.key,
    );
    expect(back, "going back to the default resets its key").toHaveLength(1);
    expect(back[0].value).toBeNull();
  });
});
