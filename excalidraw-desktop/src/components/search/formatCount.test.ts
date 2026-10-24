import { describe, expect, it } from "vitest";

import { formatCount } from "./formatCount";

describe("formatCount", () => {
  it("matches toLocaleString en-US for whole numbers", () => {
    const samples = [
      0,
      1,
      9,
      10,
      99,
      100,
      999,
      1000,
      1001,
      12345,
      99999,
      100000,
      123456,
      999999,
      1000000,
      1234567,
      12345678,
      2 ** 31,
      2 ** 40,
      987654321012,
      -1,
      -999,
      -1000,
      -1234567,
    ];
    for (const n of samples) {
      expect(formatCount(n)).toBe(n.toLocaleString("en-US"));
    }
  });
  it("falls back to the locale formatter for anything but safe integers", () => {
    expect(formatCount(1234.5)).toBe((1234.5).toLocaleString("en-US"));
    expect(formatCount(-0)).toBe((-0).toLocaleString("en-US"));
    expect(formatCount(NaN)).toBe(NaN.toLocaleString("en-US"));
    expect(formatCount(Infinity)).toBe(Infinity.toLocaleString("en-US"));
    expect(formatCount(1e21)).toBe((1e21).toLocaleString("en-US"));
  });
});
