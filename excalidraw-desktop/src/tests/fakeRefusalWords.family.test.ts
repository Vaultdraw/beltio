/**
 * Family hunter shell (2026-10-31), twins: the browser fake of the vault (what every Playwright
 * spec talks to) refuses the same names as the native core (`vaultNameRules.test.ts` pins the
 * yes/no over `name_rules.json`) but says it in its own words for five of the refusals: the
 * rows without a `says` in that table. The Mac user reads the native words; an e2e spec that
 * asserts plain words reads the fake's ("traversal/empty segment rejected: ../x"), so it can
 * neither pass nor fail for the right reason (the File conflict > Save as copy dialog shows the
 * repository's text as is). Native words: `paths.rs component_problem` and `validate_relative`.
 * Each row is `it.fails` until the fake says the native sentence (toimprove 317).
 */
import { describe, expect, it } from "vitest";

import { FakeVaultRepository } from "./fakeVaultRepository";

const messageOf = async (path: string): Promise<string> => {
  const repo = new FakeVaultRepository();
  try {
    await repo.createFolder(repo.handle, path);
    return "";
  } catch (e) {
    return (e as { message?: string }).message ?? String(e);
  }
};

const ROWS: [label: string, path: string, native: string][] = [
  ["empty segment", "a//b", "A name cannot be empty"],
  ["dot segment", "a/./b", "A name cannot be only dots"],
  ["parent segment", "a/../b", "A name cannot be only dots"],
  ["backslash", "a\\b", "forward slashes"],
  ["absolute path", "/a", "forward slashes"],
];

describe("family (twins): the fake refuses in the native core's words", () => {
  it("sanity: a name the fake words like the native core already passes", async () => {
    expect(await messageOf("a?b")).toContain("is not allowed in a name");
  });
  for (const [label, path, native] of ROWS) {
    it.fails(`${label}: says "${native}" (toimprove 317)`, async () => {
      expect(await messageOf(path)).toContain(native);
    });
  }
});
