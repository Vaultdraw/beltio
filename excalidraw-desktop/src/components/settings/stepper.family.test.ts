import { describe, expect, it } from "vitest";

import { stepValue, typedValue } from "./stepper";

import type { StepRange } from "./stepper";

/**
 * Family sweep (validator 2026-10-30, found while triaging toimprove 159 "pdf-quality changes on
 * screen but the config has no new value"): every number setting moves exactly one step per arrow
 * press, up and down, from every value on its grid, and lands on a clean number.
 *
 * Bug: `stepValue` divides by a fractional step in floating point: (0.85 - 0.5) / 0.05 is
 * 6.999999999999999, so ArrowUp from the PDF quality default 0.85 gives 0.8500000000000001,
 * the caller rounds it back to 0.85, and the press does nothing. Same at 0.6, 0.7, 0.95 (up)
 * and 0.55, 0.65 (down). Obsidian and Zed number fields always move one step.
 *
 * Ranges: every <Stepper> in Settings with a step below 1, plus plugin-declared steps
 * (DeclaredSettingsPage, any step a plugin picks). Rows marked `fails` are confirmed broken on
 * main; the fixer drops `fails` once stepValue snaps on a rounded cell.
 */
type Row = { name: string; range: StepRange; known?: boolean };

const RANGES: Row[] = [
  {
    name: "PDF JPEG quality",
    range: { min: 0.5, max: 1, step: 0.05 },
    known: true,
  },
  { name: "heading size", range: { min: 0.5, max: 8, step: 0.125 } },
  { name: "Markdown block gap", range: { min: 0, max: 4, step: 0.25 } },
  { name: "stroke width", range: { min: 0.5, max: 40, step: 0.5 } },
  {
    name: "plugin step 0.1",
    range: { min: 0, max: 3, step: 0.1 },
    known: true,
  },
  {
    name: "plugin step 0.01",
    range: { min: 0, max: 1, step: 0.01 },
    known: true,
  },
  {
    name: "plugin step 0.05 from 0.05",
    range: { min: 0.05, max: 2, step: 0.05 },
    known: true,
  },
  { name: "whole steps", range: { min: 200, max: 60000, step: 200 } },
];

const decimals = (step: number) => (String(step).split(".")[1] ?? "").length;
const grid = ({ min, max, step }: StepRange) => {
  const out: number[] = [];
  const d = decimals(step);
  for (let i = 0; min + i * step <= max + 1e-9 && i < 2000; i++) {
    out.push(Number((min + i * step).toFixed(d)));
  }
  return out;
};

describe("every number setting moves one clean step per arrow press", () => {
  for (const row of RANGES) {
    (row.known ? it.fails : it)(row.name, () => {
      const g = grid(row.range);
      const bad: string[] = [];
      g.forEach((v, i) => {
        const up = stepValue(v, 1, row.range);
        const down = stepValue(v, -1, row.range);
        const wantUp = g[Math.min(i + 1, g.length - 1)];
        const wantDown = g[Math.max(i - 1, 0)];
        if (up !== wantUp) {
          bad.push(`${v} up -> ${up} (want ${wantUp})`);
        }
        if (down !== wantDown) {
          bad.push(`${v} down -> ${down} (want ${wantDown})`);
        }
      });
      expect(bad).toEqual([]);
    });
  }
});

describe("a typed number lands on the grid as a clean number", () => {
  for (const row of RANGES) {
    it(row.name, () => {
      const bad = grid(row.range).filter(
        (v) => typedValue(String(v), row.range) !== v,
      );
      expect(bad).toEqual([]);
    });
  }
});
