/**
 * One list of keys (philosophy audit check 2, guard half): CONFIG_MAPPING is the table. The JSON
 * schema, the first-launch config.toml and docs/configuration.md are generated from or checked
 * against it (configReference.test.ts, configSchema.test.ts); this closes the loop for Settings:
 * every row that claims a config key names a key the app reads and docs/configuration.md lists.
 * Design for generating Settings from the table too: personal/feature/philosophy-fu/PLAN.md.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { SETTINGS_SCHEMA } from "../components/settings/schema";
import { NATIVE_KEYS } from "../vault/configKeys";
import { CONFIG_MAPPING } from "../vault/settingsSync";

const doc = readFileSync(
  resolve(__dirname, "../../../docs/configuration.md"),
  "utf8",
);
const known = new Set<string>([
  ...CONFIG_MAPPING.map((m) => m.key),
  ...NATIVE_KEYS,
]);

/** Settings rows whose key is read by a table-specific loader, not CONFIG_MAPPING. */
const OTHER_LOADERS = (key: string) =>
  key.startsWith("tools.") || key.startsWith("hotkeys") || key.startsWith("plugin");

const rows = SETTINGS_SCHEMA.filter((s) => s.configKey);

describe("Settings, the key table and the docs agree", () => {
  it("has rows with config keys", () => {
    expect(rows.length).toBeGreaterThan(20);
  });

  it("every Settings configKey is a key the app reads", () => {
    const unknown = rows
      .filter((r) => !known.has(r.configKey!) && !OTHER_LOADERS(r.configKey!))
      .map((r) => `${r.id}: ${r.configKey}`);
    expect(unknown).toEqual([]);
  });

  it("every Settings configKey is listed in docs/configuration.md", () => {
    const undocumented = rows
      .map((r) => r.configKey!)
      .filter((k) => !doc.includes(`\`${k.split(".").slice(-1)[0]}\``))
      .map((k) => k);
    expect(undocumented).toEqual([]);
  });

  it("no two Settings rows claim the same key", () => {
    const seen = new Map<string, string>();
    const dup: string[] = [];
    for (const r of rows) {
      const k = r.configKey!;
      if (seen.has(k)) {
        dup.push(`${k}: ${seen.get(k)} and ${r.id}`);
      }
      seen.set(k, r.id);
    }
    expect(dup).toEqual([]);
  });
});
