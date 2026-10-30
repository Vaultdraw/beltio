import { describe, expect, it } from "vitest";

import { stepValue, typedValue } from "./stepper";
describe("no bound (a plugin setting without min or max, toimprove 234)", () => {
  const open = { min: -Infinity, max: Infinity, step: 1 };
  it("steps and takes typed values on a grid from 0", () => {
    expect(stepValue(1000, 1, open)).toBe(1001);
    expect(stepValue(0, -1, open)).toBe(-1);
    expect(typedValue("5000", open)).toBe(5000);
    expect(typedValue("-20", open)).toBe(-20);
    expect(typedValue("2.4", { ...open, step: 0.5 })).toBe(2.5);
  });
});
