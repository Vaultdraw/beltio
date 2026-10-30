import { describe, expect, it } from "vitest";

import rules from "../../src-tauri/crates/vaultdraw-core/src/contract/name_rules.json";

import { FakeVaultRepository } from "./fakeVaultRepository";

/**
 * FakeVaultRepository (the browser e2e backend) must refuse the same names as the native core
 * (`paths.rs`, `validate_relative`); the Rust test `name_rules_match_the_shared_table` reads the
 * same table. Rows where the fake is more lenient than the native core are `it.fails` (hunter A,
 * round 3): they flip red when the fake is fixed, which is the moment to drop `fails`.
 */
type Row = { name: string; path: string; invalid: boolean };

const answer = async (
  path: string,
): Promise<"ok" | "INVALID_PATH" | string> => {
  const repo = new FakeVaultRepository();
  try {
    await repo.createFolder(repo.handle, path);
    return "ok";
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
};

/** Rows where the fake is more lenient than the native core (drift, to be fixed in the fake). */
const fakeAcceptsToday = (c: Row) =>
  c.invalid &&
  c.name !== "empty segment" &&
  c.name !== "backslash" &&
  c.name !== "dot segment" &&
  c.name !== "parent segment" &&
  c.name !== "metadata folder in any case";

describe("FakeVaultRepository refuses the names the native core refuses", () => {
  for (const c of rules.cases as Row[]) {
    const run = async () => {
      const got = await answer(c.path);
      expect(
        got === "INVALID_PATH",
        `${c.name}: ${JSON.stringify(c.path.slice(0, 40))} -> ${got}`,
      ).toBe(c.invalid);
    };
    if (fakeAcceptsToday(c)) {
      it.fails(`${c.name} (drift: the fake accepts it)`, run);
    } else {
      it(c.name, run);
    }
  }
});
