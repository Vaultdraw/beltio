import { describe, expect, it } from "vitest";

import table from "../../src-tauri/crates/vaultdraw-core/src/contract/profile_names.json";
import { profileNameError } from "../vault/profiles";

// Family hunter shell (2026-10-31), "name rules: dialog = core": the New profile dialog's rule was
// a second copy of the Rust one with no shared table (testing.md: twins share one case table).
// This table is read here and by `tests/profile_names_contract.rs`.
type Row = {
  label: string;
  name: string | { repeat: string; times: number };
  ok: boolean;
};
const nameOf = (r: Row) =>
  typeof r.name === "string" ? r.name : r.name.repeat.repeat(r.name.times);

describe("profile names: the dialog agrees with the native rule", () => {
  for (const r of table.cases as Row[]) {
    it(r.label, () => {
      // The dialog trims what is typed before it checks; the table rows are the trimmed names.
      expect(profileNameError(nameOf(r), []) === null).toBe(r.ok);
    });
  }
  it("a name that exists, in any case, is refused", () => {
    expect(profileNameError("Work", ["work"])).toMatch(/already exists/);
  });
});
