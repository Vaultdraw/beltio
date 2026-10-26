/** Limits of the `[watchdog]` keys (the native side applies the same ones). */
export const WATCHDOG_LIMITS = {
  graceMs: { min: 1000, max: 60000 },
} as const;
