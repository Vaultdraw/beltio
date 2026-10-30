import { describe, expect, it } from "vitest";

import { typedValue } from "./stepper";

// Hunter D-3 family: every number setting takes a typed value, clamped and put on its grid.
const R = { min: 100, max: 10000, step: 100 };

describe("typedValue", () => {
  it.each([
    ["5000", R, 5000],
    ["  750 ", R, 800],
    ["5000 elements", R, 5000],
    ["99999", R, 10000],
    ["-5", R, 100],
    ["1,5", { min: 0, max: 5, step: 0.5 }, 1.5],
    ["0.3", { min: 0, max: 1, step: 0.1 }, 0.3],
    [".25", { min: 0, max: 1, step: 0.05 }, 0.25],
    ["abc", R, null],
    ["", R, null],
  ] as const)("%j -> %s", (text, range, out) => {
    expect(typedValue(text, range)).toBe(out);
  });
});
