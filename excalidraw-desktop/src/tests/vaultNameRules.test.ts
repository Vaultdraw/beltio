import { describe, expect, it } from "vitest";

import rules from "../../src-tauri/crates/vaultdraw-core/src/contract/name_rules.json";

import { FakeVaultRepository } from "./fakeVaultRepository";

/**
 * FakeVaultRepository (the browser e2e backend) must refuse the same names as the native core
 * (`paths.rs`, `validate_relative`); the Rust test `name_rules_match_the_shared_table` reads the
 * same table. Rows where the fake is more lenient than the native core are `it.fails` (hunter A,
 * round 3): they flip red when the fake is fixed, which is the moment to drop `fails`.
 */
type Row = { name: string; path: string; invalid: boolean; says?: string };

const answer = async (
  path: string,
): Promise<{ code: string; message: string }> => {
  const repo = new FakeVaultRepository();
  try {
    await repo.createFolder(repo.handle, path);
    return { code: "ok", message: "" };
  } catch (e) {
    const x = e as { code?: string; message?: string };
    return { code: x.code ?? String(e), message: x.message ?? "" };
  }
};

describe("FakeVaultRepository refuses the names the native core refuses", () => {
  for (const c of rules.cases as Row[]) {
    const run = async () => {
      const got = await answer(c.path);
      expect(
        got.code === "INVALID_PATH",
        `${c.name}: ${JSON.stringify(c.path.slice(0, 40))} -> ${got.code}`,
      ).toBe(c.invalid);
      // A refusal says why in plain words, never "invalid component" (A-15).
      if (c.invalid) {
        expect(got.message).not.toMatch(/invalid component|Path contains/i);
      }
      if (c.says) {
        expect(got.message).toContain(c.says);
      }
    };
    it(c.name, run);
  }
});
