import { describe, expect, it } from "vitest";

import { parsePageRange } from "../src/pageRange";

describe("parsePageRange", () => {
  it("empty and all select every page", () => {
    expect(parsePageRange("", 3)).toEqual({ pages: [0, 1, 2] });
    expect(parsePageRange(" All ", 2)).toEqual({ pages: [0, 1] });
  });

  it("parses lists, ranges and open ranges, sorted and unique", () => {
    expect(parsePageRange("8, 1-3, 2, 10-", 11)).toEqual({
      pages: [0, 1, 2, 7, 9, 10],
    });
  });

  it("rejects bad input with a message", () => {
    for (const bad of ["0", "5-2", "x", "1,,2", "-3", "1-2-3", "4"]) {
      expect(parsePageRange(bad, 3)).toHaveProperty("error");
    }
    expect(parsePageRange("9", 3)).toEqual({
      error: "The document has 3 pages",
    });
  });
});
