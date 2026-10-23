/**
 * Waits for `promise` but never longer than `ms`: resolves true when it
 * settled in time (even if it rejected), false when the time ran out. The
 * promise keeps running either way; the timer is cleared as soon as it settles.
 */
export function waitAtMost(
  promise: Promise<unknown>,
  ms: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    const done = () => {
      clearTimeout(timer);
      resolve(true);
    };
    promise.then(done, done);
  });
}
