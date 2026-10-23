/**
 * Rewrite jobs started by a tag rename. The links wiring's generic
 * "Updated N links" toast skips them: the tag flow reports its own message.
 *
 * A small native job can finish (and emit `links-rewrite-done`) before the
 * rename invoke resolves with its job id. So the flow opens a gate before
 * invoking and closes it once the id is claimed (or the invoke failed); the
 * links toast decides only when no gate is open.
 */
const jobs = new Set<number>();
let inFlight = 0;
let deferred: (() => void)[] = [];

export const claimTagJob = (jobId: number) => void jobs.add(jobId);
export const releaseTagJob = (jobId: number) => void jobs.delete(jobId);
export const isTagJob = (jobId: number) => jobs.has(jobId);

/** Opens a gate; call the returned function (idempotent) once the job id is claimed or the rename failed. */
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
      run.forEach((fn) => fn());
    }
  };
}

/** Runs `fn` now, or once every in-flight tag rename knows its job id. */
export function whenTagJobsKnown(fn: () => void): void {
  if (inFlight === 0) {
    fn();
  } else {
    deferred.push(fn);
  }
}
