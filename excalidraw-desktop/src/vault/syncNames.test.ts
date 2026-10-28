import { describe, expect, it } from "vitest";

import fixtures from "./fixtures/syncnames.json";
import {
  conflictOriginal,
  isSyncTempName,
  numberedCopyOriginal,
  placeholderRealName,
} from "./syncNames";

describe("syncNames (shared fixtures with the Rust twin)", () => {
  it("conflict copies", () => {
    for (const [name, original] of fixtures.conflict) {
      expect(conflictOriginal(name as string), name as string).toBe(original);
    }
  });
  it("iCloud numbered copies", () => {
    for (const [name, original] of fixtures.numbered) {
      expect(numberedCopyOriginal(name as string), name as string).toBe(
        original,
      );
    }
  });
  it("iCloud placeholders", () => {
    for (const [name, real] of fixtures.placeholder) {
      expect(placeholderRealName(name as string), name as string).toBe(real);
    }
  });
  it("temporary files", () => {
    for (const [name, temp] of fixtures.temp) {
      expect(isSyncTempName(name as string), name as string).toBe(temp);
    }
  });
});
