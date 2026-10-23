/** Persistent thumbnail cache behind the service (native = Rust, tests/e2e = fake). */

export type LookupState = "hit" | "miss" | "failed" | "missing" | "pending";
export type LookupItem = { rev: string | null; state: LookupState };
export type LookupResult = { vaultId: string; items: LookupItem[] };

export interface ThumbnailStore {
  /**
   * One item per path, same order. `pending` = retry on the next frame.
   * `failVersion` names the fail markers that count (default `renderVersion`).
   */
  lookup(
    handle: string,
    paths: string[],
    renderVersion: number,
    failVersion?: number,
  ): Promise<LookupResult>;
  /**
   * `png` null stores a fail marker (pass its fail version as `renderVersion`).
   * Resolves the image url (null for a marker).
   */
  put(
    handle: string,
    path: string,
    rev: string,
    png: Blob | null,
    renderVersion: number,
  ): Promise<string | null>;
  /** Image url of a cached PNG (the name carries the render version). */
  urlFor(vaultId: string, rev: string, renderVersion: number): string;
  clear(handle: string): Promise<void>;
}

/** Max paths per lookup call (the Rust side rejects more). */
export const LOOKUP_BATCH_MAX = 500;
