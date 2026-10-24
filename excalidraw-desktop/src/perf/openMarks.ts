/**
 * Timeline marks of a drawing open (report-only, read by the perf harness):
 * `vaultdraw:open:<step>`. One open's marks replace the previous open's, so
 * a long session never accumulates them.
 */
export type OpenStep =
  | "read"
  | "read-done"
  | "activate"
  | "parse"
  | "parsed"
  | "preloaded"
  | "landed";

const PREFIX = "vaultdraw:open:";
const STEPS: readonly OpenStep[] = [
  "read",
  "read-done",
  "activate",
  "parse",
  "parsed",
  "preloaded",
  "landed",
];

export const markOpen = (step: OpenStep) => {
  try {
    if (step === "read") {
      for (const name of STEPS) {
        performance.clearMarks(PREFIX + name);
      }
    } else {
      // opens that skip "read" (tabs, create, reload from disk) replace
      // their own step's mark: at most one mark per step, ever
      performance.clearMarks(PREFIX + step);
    }
    performance.mark(PREFIX + step);
  } catch {
    // marks are diagnostics only
  }
};

/** The current open's marks, ms since `since` (perf harness). */
export const readOpenMarks = (since: number): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const entry of performance.getEntriesByType("mark")) {
    if (entry.name.startsWith(PREFIX) && entry.startTime >= since) {
      out[entry.name.slice(PREFIX.length)] =
        Math.round((entry.startTime - since) * 10) / 10;
    }
  }
  return out;
};
