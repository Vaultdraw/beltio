/**
 * "Rename tag across the vault" orchestration (mirrors links/moveFlow):
 * validate the new spelling, flush the open drawing, run the native rename,
 * apply the open drawing's edits through the editor, then report when the
 * background rewrite of the other drawings finishes.
 */
import { findTags } from "./grammar";
import { beginTagRename, claimTagJob, releaseTagJob } from "./renameJobs";

import type { ElementEdit, RewriteDone, VaultLinks } from "../links/types";
import type { VaultTagRename } from "./types";

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

export type TagInput =
  | { ok: true; display: string }
  | { ok: false; error: string };

/** The field must hold exactly one whole tag (a leading `#` is optional). */
export function validateTagInput(text: string): TagInput {
  const body = text.trim().replace(/^#/, "");
  if (body === "") {
    return { ok: false, error: "Enter a tag name" };
  }
  const found = findTags(`#${body}`);
  if (found.length !== 1 || found[0].end !== body.length + 1) {
    return {
      ok: false,
      error:
        "Not a valid tag: use letters, digits, _ - and / with at least one letter",
    };
  }
  return { ok: true, display: body };
}

export const renamedMessage = (from: string, to: string, drawings: number) =>
  `Renamed #${from} to #${to} in ${plural(drawings, "drawing", "drawings")}`;

export const skippedMessage = (done: RewriteDone) =>
  done.failed
    .map(
      (f) =>
        `${f.path} (${f.code === "CONFLICT" ? "changed on disk" : f.code})`,
    )
    .join(", ");

export type TagRenameDeps = {
  api: VaultTagRename;
  /** For the `links-rewrite-done` event; without it no completion toast. */
  links: Pick<VaultLinks, "onRewriteDone"> | null;
  handle: string;
  openPath: string | null;
  /** Writes the open drawing's pending save to disk first. */
  flush(): Promise<void>;
  /** Undoable edits to the open drawing; returns how many elements changed. */
  applyEdits(edits: ElementEdit[]): number;
  notify(message: string, type: "info" | "error"): void;
};

/**
 * Rename `from` (folded key) to `to` (display spelling). Resolves once the
 * native job is queued and the open drawing is edited, with `completed`
 * settling after the completion toast (the background rewrite). `fromDisplay`
 * is only for messages. Throws on a native error.
 */
export async function runTagRename(
  deps: TagRenameDeps,
  from: string,
  to: string,
  fromDisplay = from,
): Promise<{ completed: Promise<void> }> {
  await deps.flush();
  // Listen before invoking so a fast job cannot finish unseen.
  const early = new Map<number, RewriteDone>();
  let waiter: ((d: RewriteDone) => void) | null = null;
  let wanted: number | null = null;
  let off: (() => void) | undefined;
  let stop = false;
  const stopListening = () => {
    stop = true;
    off?.();
  };
  if (deps.links) {
    deps.links
      .onRewriteDone((d) => {
        if (d.handle !== deps.handle) {
          return;
        }
        if (wanted === d.jobId) {
          waiter?.(d);
        } else {
          early.set(d.jobId, d);
        }
      })
      .then((u) => (stop ? u() : (off = u)))
      .catch(() => {});
  }
  // Until the job id is claimed, the links toast holds its decision.
  const jobKnown = beginTagRename();
  let result;
  try {
    result = await deps.api.rename(deps.handle, from, to, deps.openPath);
  } catch (err) {
    jobKnown();
    stopListening();
    throw err;
  }
  const { jobId } = result;
  if (jobId !== null && deps.links) {
    claimTagJob(jobId);
  }
  jobKnown();
  const open =
    result.openDrawingEdits.length > 0
      ? deps.applyEdits(result.openDrawingEdits)
      : 0;
  const openCount = open > 0 ? 1 : 0;
  if (jobId === null || !deps.links) {
    stopListening();
    if (openCount > 0) {
      deps.notify(renamedMessage(fromDisplay, to, openCount), "info");
    }
    return { completed: Promise.resolve() };
  }
  const completed = (async () => {
    const done =
      early.get(jobId) ??
      (await new Promise<RewriteDone>((resolve) => {
        wanted = jobId;
        waiter = resolve;
      }));
    stopListening();
    releaseTagJob(jobId);
    const n = done.rewritten + openCount;
    if (done.failed.length > 0) {
      deps.notify(
        `${renamedMessage(fromDisplay, to, n)}; skipped: ${skippedMessage(
          done,
        )}`,
        "error",
      );
    } else {
      deps.notify(renamedMessage(fromDisplay, to, n), "info");
    }
  })();
  return { completed };
}
