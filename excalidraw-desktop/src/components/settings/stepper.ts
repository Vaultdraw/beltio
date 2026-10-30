export interface StepRange {
  min: number;
  max: number;
  step: number;
}

/**
 * One stepper move: the next grid value above (dir 1) or below (dir -1),
 * clamped to the range. A value off the grid (hand-edited config) first lands
 * on the grid.
 */
export const stepValue = (
  value: number,
  dir: 1 | -1,
  { min, max, step }: StepRange,
): number => {
  const cell = (value - min) / step;
  const next = dir === 1 ? Math.floor(cell) + 1 : Math.ceil(cell) - 1;
  return Math.min(max, Math.max(min, min + next * step));
};

/**
 * A typed value (hunter D-3: numbers could only be stepped): the number in `text`, clamped to the
 * range and rounded to the nearest grid value, like Obsidian and Zed number fields. A unit typed
 * after it ("500 ms") is ignored. Null when `text` holds no number (the field goes back).
 */
export const typedValue = (
  text: string,
  { min, max, step }: StepRange,
): number | null => {
  const m = /^\s*(-?\d+(?:[.,]\d+)?|-?[.,]\d+)/.exec(text);
  if (!m) {
    return null;
  }
  const n = Number(m[1].replace(",", "."));
  if (!Number.isFinite(n)) {
    return null;
  }
  const clamped = Math.min(max, Math.max(min, n));
  const snapped = min + Math.round((clamped - min) / step) * step;
  // Keep the step's decimals (0.1 steps print 0.3, not 0.30000000000000004).
  const decimals = (String(step).split(".")[1] ?? "").length;
  return Math.min(max, Number(snapped.toFixed(decimals)));
};
