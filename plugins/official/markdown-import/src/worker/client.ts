/**
 * The main-thread side of the layout worker. `createLayoutClient()` runs a
 * layout in a Blob worker built from `__MD_WORKER_SOURCE__` (a string the
 * plugin build injects; see esbuild.mjs) and falls back to the same
 * generator in-thread, one page per macrotask, where workers do not exist
 * (vitest, jsdom) or the source was not injected. Cancel with an
 * `AbortSignal`: the worker is terminated, the fallback stops at the next
 * page.
 */
import { layoutNoteStream } from "../layout/index";
import { widthTableTransferables } from "../layout/widthTable";

import type { NoteDoc } from "@vaultdraw/api";
import type { LayoutEvent, LayoutOptions, LayoutStats } from "../layout/types";
import type { WidthTable } from "../layout/widthTable";
import type { LayoutRequest, WorkerReply } from "./protocol";

declare const __MD_WORKER_SOURCE__: string;

export interface LayoutRun {
  doc: NoteDoc;
  /** Consumed: its buffers are transferred to the worker. */
  table: WidthTable;
  opts: LayoutOptions;
  /** Every event but `done`, in order. */
  onEvent: (event: Exclude<LayoutEvent, { type: "done" }>) => void;
  signal?: AbortSignal;
}

export interface LayoutClient {
  /** True when runs go to a worker; false for the in-thread fallback. */
  readonly inWorker: boolean;
  /** Resolves with the stats when the layout is complete; rejects on error or abort. */
  layout(run: LayoutRun): Promise<LayoutStats>;
}

export class LayoutAbortedError extends Error {
  constructor() {
    super("Layout cancelled");
    this.name = "LayoutAbortedError";
  }
}

const workerSource = (): string | null => {
  try {
    return typeof __MD_WORKER_SOURCE__ === "string" && __MD_WORKER_SOURCE__
      ? __MD_WORKER_SOURCE__
      : null;
  } catch {
    return null;
  }
};

const canUseWorker = () =>
  typeof Worker === "function" &&
  typeof Blob === "function" &&
  typeof URL !== "undefined" &&
  typeof URL.createObjectURL === "function";

export interface LayoutClientOptions {
  /** Force the in-thread fallback (tests). */
  inThread?: boolean;
  /** Yield between pages in the fallback; default `setTimeout(0)`. */
  yieldToHost?: () => Promise<void>;
}

const nextMacrotask = () => new Promise<void>((r) => setTimeout(r, 0));

export const createLayoutClient = (
  options: LayoutClientOptions = {},
): LayoutClient => {
  const source = options.inThread ? null : workerSource();
  const inWorker = source !== null && canUseWorker();
  const yieldToHost = options.yieldToHost ?? nextMacrotask;

  const runInWorker = (run: LayoutRun): Promise<LayoutStats> =>
    new Promise((resolve, reject) => {
      const url = URL.createObjectURL(
        new Blob([source!], { type: "text/javascript" }),
      );
      const worker = new Worker(url);
      URL.revokeObjectURL(url);
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        run.signal?.removeEventListener("abort", onAbort);
        worker.terminate();
        fn();
      };
      const onAbort = () => finish(() => reject(new LayoutAbortedError()));
      if (run.signal?.aborted) {
        onAbort();
        return;
      }
      run.signal?.addEventListener("abort", onAbort);
      worker.onmessage = (event: MessageEvent<WorkerReply>) => {
        const reply = event.data;
        if (reply.type === "done") {
          finish(() => resolve(reply.stats));
        } else if (reply.type === "error") {
          finish(() => reject(new Error(reply.message)));
        } else {
          run.onEvent(reply);
        }
      };
      worker.onerror = (event) =>
        finish(() =>
          reject(new Error(event.message || "Layout worker failed")),
        );
      const request: LayoutRequest = {
        type: "layout",
        doc: run.doc,
        table: run.table,
        opts: run.opts,
      };
      worker.postMessage(request, widthTableTransferables(run.table));
    });

  const runInThread = async (run: LayoutRun): Promise<LayoutStats> => {
    const gen = layoutNoteStream(run.doc, run.table, run.opts);
    try {
      for (const ev of gen) {
        if (run.signal?.aborted) {
          throw new LayoutAbortedError();
        }
        if (ev.type === "done") {
          return ev.stats;
        }
        run.onEvent(ev);
        if (ev.type === "page") {
          await yieldToHost();
        }
      }
      throw new Error("Layout ended without a result");
    } finally {
      gen.return(undefined);
    }
  };

  return {
    inWorker,
    layout: inWorker ? runInWorker : runInThread,
  };
};
