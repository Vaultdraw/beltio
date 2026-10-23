/**
 * Runs `run` when the window is idle; WebKit has no requestIdleCallback, so a
 * short timeout stands in. Returns a cancel function.
 */
export interface IdleOptions {
  /** requestIdleCallback deadline (ms); none by default. */
  timeout?: number;
  /** Delay when requestIdleCallback is missing (ms), default 50. */
  fallbackMs?: number;
}

export function scheduleIdle(
  win: Window,
  run: () => void,
  { timeout, fallbackMs = 50 }: IdleOptions = {},
): () => void {
  if (typeof win.requestIdleCallback === "function") {
    const id = win.requestIdleCallback(
      () => run(),
      timeout === undefined ? undefined : { timeout },
    );
    return () => win.cancelIdleCallback?.(id);
  }
  const id = win.setTimeout(run, fallbackMs);
  return () => win.clearTimeout(id);
}
