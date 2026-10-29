import { describe, expect, it } from "vitest";

import { SETTINGS_SCHEMA } from "./schema";

// Bug hunt round 4 (BH-16): descriptions the user reads must not show config
// table headers such as [backup], [hotkeys], [extensions]. ([[links]] is the
// note-link syntax, not a config key.)
describe("settings descriptions use plain words", () => {
  it("show no [table] config headers", () => {
    const bad = SETTINGS_SCHEMA.filter((s) =>
      /(^|[^[])\[[a-z_.]+\](?!\])/.test(s.description ?? ""),
    ).map((s) => `${s.id}: ${s.description}`);
    expect(bad).toEqual([]);
  });
});
