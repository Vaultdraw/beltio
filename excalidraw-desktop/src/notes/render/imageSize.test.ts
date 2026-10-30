import { describe, expect, it } from "vitest";

import cases from "../../../src-tauri/crates/vaultdraw-core/src/markdown/alt_size_cases.json";

import { altAndSize } from "./imageSize";

describe("altAndSize follows the shared case table", () => {
  for (const [input, alt, width, height] of cases as [
    string,
    string,
    number | null,
    number | null,
  ][]) {
    it(JSON.stringify(input), () => {
      const r = altAndSize(input);
      expect(r.alt).toBe(alt);
      expect(r.width ?? null).toBe(width);
      expect(r.height ?? null).toBe(height);
    });
  }
});
