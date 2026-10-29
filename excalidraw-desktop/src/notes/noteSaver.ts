/**
 * Saves a note after typing stops, one write at a time, always against the
 * revision it was read with. A conflict (the file changed on disk) stops
 * saving and asks the caller to reload: the note on disk is never
 * overwritten. Plain class, no React; NoteView owns one per open note.
 */
import { NoteConflictError } from "./noteFiles";

import type { NoteWritten } from "./noteFiles";

export type SaveStatus = "saved" | "dirty" | "saving" | "conflict" | "error";

export interface NoteSaverDeps {
  write: (content: string, revision: string) => Promise<NoteWritten>;
  /** Wait after the last change; 0 = only an explicit save. Read on every change. */
  delayMs: () => number;
  onStatus: (status: SaveStatus, message?: string) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

export class NoteSaver {
  private revision: string;
  private saved: string;
  private latest: string;
  private status: SaveStatus = "saved";
  private timer: unknown = null;
  private inflight: Promise<void> | null = null;

  constructor(
    private readonly deps: NoteSaverDeps,
    initial: { text: string; revision: string },
  ) {
    this.revision = initial.revision;
    this.saved = initial.text;
    this.latest = initial.text;
  }

  get state(): SaveStatus {
    return this.status;
  }

  /** The revision on disk the saved text matches. */
  get currentRevision(): string {
    return this.revision;
  }

  /** The note was (re)read from disk: this text and revision are the new base. */
  rebase(text: string, revision: string): void {
    this.cancel();
    this.revision = revision;
    this.saved = text;
    this.latest = text;
    this.set("saved");
  }

  /**
   * "Keep mine" after a conflict: the disk's current revision becomes the
   * base, so the next write replaces the disk version (a history copy of it is
   * kept by the backend). The caller then flushes.
   */
  adoptRevision(revision: string): void {
    this.revision = revision;
    this.set(this.latest === this.saved ? "saved" : "dirty");
  }

  /** The editor text changed. */
  change(text: string): void {
    this.latest = text;
    if (this.status === "conflict") {
      return;
    }
    if (text === this.saved && !this.inflight) {
      this.cancel();
      this.set("saved");
      return;
    }
    this.set(this.inflight ? "saving" : "dirty");
    const ms = this.deps.delayMs();
    this.cancel();
    if (ms > 0) {
      this.timer = (this.deps.setTimer ?? ((f, t) => setTimeout(f, t)))(
        () => void this.flush(),
        ms,
      );
    }
  }

  /** Writes now when there is something to write; resolves when it is on disk. */
  async flush(): Promise<void> {
    this.cancel();
    // Several callers can wait on one write (blur, Cmd+E, closing): each wakes in turn and
    // re-checks, so only one starts the next write, against the revision the last one returned.
    while (this.inflight) {
      await this.inflight;
    }
    if (this.status === "conflict" || this.latest === this.saved) {
      return;
    }
    const content = this.latest;
    this.set("saving");
    const write = (async () => {
      try {
        const result = await this.deps.write(content, this.revision);
        this.revision = result.revision;
        this.saved = content;
        this.set(this.latest === content ? "saved" : "dirty");
      } catch (err) {
        if (err instanceof NoteConflictError) {
          this.set("conflict");
        } else {
          this.set("error", err instanceof Error ? err.message : String(err));
        }
      }
    })();
    this.inflight = write;
    try {
      await write;
    } finally {
      if (this.inflight === write) {
        this.inflight = null;
      }
    }
    // Typed during the write: write again (or schedule it).
    if (this.status === "dirty") {
      const ms = this.deps.delayMs();
      if (ms > 0) {
        this.change(this.latest);
      }
    }
  }

  dispose(): void {
    this.cancel();
  }

  private cancel(): void {
    if (this.timer !== null) {
      (this.deps.clearTimer ?? ((id) => clearTimeout(id as number)))(
        this.timer,
      );
      this.timer = null;
    }
  }

  private set(status: SaveStatus, message?: string): void {
    this.status = status;
    this.deps.onStatus(status, message);
  }
}
