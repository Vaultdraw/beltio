/**
 * The generic "Updated N links" toast for a finished background rewrite
 * (`links-rewrite-done`). Rewrites started by a tag rename are skipped: the
 * tag flow reports its own message.
 */
import { isTagJob, whenTagJobsKnown } from "../tags/renameJobs";

import { updatedMessage } from "./moveFlow";

import type { RewriteDone } from "./types";

export type Notify = (message: string, type: "info" | "error") => void;

/** The toast for a links rewrite, or null when there is nothing to say. */
export function rewriteDoneMessage(
  done: RewriteDone,
): { message: string; type: "info" | "error" } | null {
  if (done.failed.length > 0) {
    const names = done.failed
      .map(
        (f) =>
          `${f.path} (${f.code === "CONFLICT" ? "changed on disk" : f.code})`,
      )
      .join(", ");
    return {
      message: `${updatedMessage(
        done.links,
        done.rewritten,
      )}; skipped: ${names}`,
      type: "error",
    };
  }
  if (done.rewritten > 0) {
    return {
      message: updatedMessage(done.links, done.rewritten),
      type: "info",
    };
  }
  return null;
}

/**
 * Toasts a finished rewrite unless a tag rename owns it. The event can arrive
 * before the tag flow learns its job id (the job finishes before the rename
 * invoke resolves), so the decision waits until no tag rename is in flight.
 */
export function toastRewriteDone(done: RewriteDone, notify: Notify): void {
  whenTagJobsKnown(() => {
    if (isTagJob(done.jobId)) {
      return;
    }
    const toast = rewriteDoneMessage(done);
    if (toast) {
      notify(toast.message, toast.type);
    }
  });
}
