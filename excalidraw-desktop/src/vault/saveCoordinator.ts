import type { SaveStatus, VaultRepository } from "./types";

export type SaveTarget = {
  handle: string;
  path: string;
  documentId: string;
  revision: string;
};

export type SaveCoordinatorOptions = {
  repository: VaultRepository;
  target: () => SaveTarget | null;
  snapshot: () => string | null;
  onStatus: (status: SaveStatus, error?: unknown) => void;
  onSaved: (revision: string, json: string) => void;
  /**
   * A promise while the document's path is being changed (rename or move):
   * writes wait for it, then read the target again, so they use the new path.
   */
  hold?: () => Promise<unknown> | null;
  idleMs?: number;
  maxWaitMs?: number;
};

const isConflict = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  String((error as { code: unknown }).code).toUpperCase() === "CONFLICT";

/** Coalesces edits into one disk write at a time; flush is a durability barrier. */
export class SaveCoordinator {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private maxTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private queued = false;
  private disposed = false;
  private stopReason: unknown = null;
  private sequence = 0;
  private waiters: Array<{
    resolve: () => void;
    reject: (error: unknown) => void;
  }> = [];
  private readonly idleMs: number;
  private readonly maxWaitMs: number;

  get isWriting() {
    return this.inFlight !== null;
  }

  constructor(private readonly options: SaveCoordinatorOptions) {
    this.idleMs = options.idleMs ?? 500;
    this.maxWaitMs = options.maxWaitMs ?? 2000;
  }

  schedule() {
    if (this.disposed) {
      return;
    }
    this.queued = true;
    this.options.onStatus("dirty");
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => void this.drain(), this.idleMs);
    if (!this.maxTimer) {
      this.maxTimer = setTimeout(() => void this.drain(), this.maxWaitMs);
    }
  }

  flush(): Promise<void> {
    if (this.disposed) {
      return Promise.reject(this.stopReason ?? new Error("Saving stopped"));
    }
    if (!this.queued && !this.inFlight) {
      return Promise.resolve();
    }
    const result = new Promise<void>((resolve, reject) =>
      this.waiters.push({ resolve, reject }),
    );
    this.clearTimers();
    void this.drain();
    return result;
  }

  /** Prevent new writes and settle the current write before callers switch documents. */
  async stop(error: unknown = new Error("Saving stopped")): Promise<void> {
    if (!this.disposed) {
      this.disposed = true;
      this.stopReason = error;
      this.queued = false;
      this.clearTimers();
      const waiters = this.waiters.splice(0);
      waiters.forEach(({ reject }) => reject(error));
    }
    await this.inFlight;
  }

  private clearTimers() {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    if (this.maxTimer) {
      clearTimeout(this.maxTimer);
    }
    this.timer = this.maxTimer = null;
  }

  private async drain(): Promise<void> {
    if (this.disposed || this.inFlight || !this.queued) {
      return;
    }
    const hold = this.options.hold?.();
    if (hold) {
      const wait = hold.then(
        () => undefined,
        () => undefined,
      );
      this.inFlight = wait;
      void wait.then(() => {
        this.inFlight = null;
        void this.drain();
      });
      return;
    }
    const target = this.options.target();
    // Capture immutable values once; refs may change while the write is pending.
    const json = this.options.snapshot();
    if (!target || json == null) {
      const error = new Error("Save target is unavailable");
      this.options.onStatus("error", error);
      const waiters = this.waiters.splice(0);
      waiters.forEach(({ reject }) => reject(error));
      return;
    }
    this.queued = false;
    this.clearTimers();
    const operationId = `${target.documentId}:${++this.sequence}`;
    const write = (async () => {
      this.options.onStatus("saving");
      const ack = await this.options.repository.writeDrawing({
        handle: target.handle,
        path: target.path,
        json,
        expectedRevision: target.revision,
        operationId,
      });
      if (!this.disposed) {
        this.options.onSaved(ack.revision, json);
        if (!this.queued) {
          this.options.onStatus("saved");
        } else {
          this.options.onStatus("dirty");
        }
      }
    })();
    this.inFlight = write.then(
      () => undefined,
      () => undefined,
    );
    let succeeded = false;
    try {
      await write;
      succeeded = true;
      if (!this.queued && !this.disposed) {
        const waiters = this.waiters.splice(0);
        waiters.forEach(({ resolve }) => resolve());
      }
    } catch (error) {
      // Retain the latest snapshot, but do not hot-loop: only flush() or a new
      // schedule() is allowed to trigger another attempt after failure.
      this.queued = true;
      if (!this.disposed) {
        this.options.onStatus(isConflict(error) ? "conflict" : "error", error);
      }
      const waiters = this.waiters.splice(0);
      waiters.forEach(({ reject }) => reject(error));
    } finally {
      this.inFlight = null;
      // An edit's timer may have fired while the previous write was in flight.
      // Re-arm only after success; failures require explicit flush/new schedule.
      if (succeeded && this.queued && !this.disposed) {
        this.schedule();
      }
    }
  }
}
