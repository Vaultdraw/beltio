/** `files.watch_poll_ms`: how often a vault is polled when the native file watcher cannot start (Linux inotify limit). The native side applies the same limits. */
export const WATCH_POLL_LIMITS = { min: 500, max: 600_000 } as const;
export const DEFAULT_WATCH_POLL_MS = 5000;

export const isWatchPollMs = (v: unknown): boolean =>
  typeof v === "number" &&
  Number.isInteger(v) &&
  v >= WATCH_POLL_LIMITS.min &&
  v <= WATCH_POLL_LIMITS.max;
