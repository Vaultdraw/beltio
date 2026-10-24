import { describe, expect, it } from "vitest";

import fixtures from "../../src-tauri/crates/vaultdraw-core/src/uri/fixtures/uri.json";

import { decodeVaultUrl } from "./linkUri";

/**
 * The in-drawing link decoder and the Rust OS-link parser share one fixture
 * file (vaultdraw_core::uri). Every case with `legacyFile` pins what
 * decodeVaultUrl returns, so the two cannot drift. Where Rust refuses a path
 * (`..`, absolute) the decoder still returns it: openTarget normalises it and
 * only accepts a drawing inside the vault.
 */
describe("decodeVaultUrl against the shared URI fixtures", () => {
  const cases = fixtures.cases.filter((c) => "legacyFile" in c);
  it("covers a useful number of cases", () => {
    expect(cases.length).toBeGreaterThan(30);
  });
  it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(decodeVaultUrl(c.input)).toBe(c.legacyFile);
  });
});
