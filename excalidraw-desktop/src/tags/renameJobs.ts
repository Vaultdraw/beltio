/**
 * Rewrite jobs started by a tag rename, keyed by (vault handle, job id). The
 * links wiring's generic "Updated N links" toast skips them: the tag flow
 * reports its own message.
 *
 * A small native job can finish (and emit `links-rewrite-done`) before the
 * rename invoke resolves with its job id. So the flow opens a gate before
 * invoking and closes it once the id is claimed (or the rename failed); the
 * links toast decides only when no gate is open, or after GATE_TIMEOUT_MS so
 * a hung rename never holds unrelated toasts.
 */
const jobs = new Set<string>();
const key = (handle: string, jobId: number) => `${handle}\u0000${jobId}`;

export const claimTagJob = (handle: string, jobId: number) =>
  void jobs.add(key(handle, jobId));
export const releaseTagJob = (handle: string, jobId: number) =>
  void jobs.delete(key(handle, jobId));
export const isTagJob = (handle: string, jobId: number) =>
  jobs.has(key(handle, jobId));

/** Longest a links toast waits for in-flight tag renames to learn their job id. */
export const GATE_TIMEOUT_MS = 3000;

type Deferred = { fn: () => void; timer: ReturnType<typeof setTimeout> };
let inFlight = 0;
let deferred: Deferred[] = [];

/** One throwing callback must not drop the others or fail the caller. */
const runSafely = (fn: () => void) => {
  try {
    fn();
  } catch (err) {
    console.error("tag rename: deferred toast failed", err);
  }
};

/**
 * Opens a gate; call the returned function (idempotent) once the job id is
 * claimed or the rename failed.
 */
export function beginTagRename(): () => void {
  inFlight += 1;
  let open = true;
  return () => {
    if (!open) {
      return;
    }
    open = false;
    inFlight -= 1;
    if (inFlight === 0) {
      const run = deferred;
      deferred = [];
      for (const d of run) {
        clearTimeout(d.timer);
        runSafely(d.fn);
      }
    }
  };
}

/**
 * Runs `fn` now, or once every in-flight tag rename knows its job id, or
 * after `timeoutMs`, whichever comes first.
 */
export function whenTagJobsKnown(
  fn: () => void,
  timeoutMs = GATE_TIMEOUT_MS,
): void {
  if (inFlight === 0) {
    runSafely(fn);
    return;
  }
  const entry: Deferred = {
    fn,
    timer: setTimeout(() => {
      deferred = deferred.filter((d) => d !== entry);
      runSafely(fn);
    }, timeoutMs),
  };
  deferred.push(entry);
}
