/**
 * Frontend half of two file-history guarantees (PLAN M15, Minor 14):
 * - M15: without staging (non-APFS), an outside change to the open drawing
 *   sends the last SAVED bytes to Rust, which keeps them only if their sha256
 *   equals the revision and they are the path's unversioned commit.
 * - Minor 14: unsaved edits are sent before a conflict reload discards them.
 *
 * Never throws, never blocks beyond a short timeout, no IPC unless needed.
 */
import type { HistoryRepository } from "./types";

export const DISCARD_TIMEOUT_MS = 300;
const STATUS_TTL_MS = 30_000;

const encoder = new TextEncoder();

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  let hex = "";
  for (const byte of new Uint8Array(digest)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

export interface OutsideFallback {
  /** Fire-and-forget. `revision` must be the revision of `savedJson`. */
  beforeOutsideChange(
    handle: string,
    path: string,
    revision: string,
    savedJson: string,
  ): void;
  /** Resolves once sent or after the timeout; never rejects. */
  beforeDiscard(handle: string, path: string, json: string): Promise<void>;
}

export function createOutsideFallback(
  getRepository: () => HistoryRepository | undefined,
  timeoutMs = DISCARD_TIMEOUT_MS,
): OutsideFallback {
  const statuses = new Map<
    string,
    { at: number; value: Promise<{ staging: boolean; off: boolean }> }
  >();
  let logged = false;
  const swallow = (cause: unknown) => {
    if (!logged) {
      logged = true;
      // eslint-disable-next-line no-console
      console.debug("history fallback failed", cause);
    }
  };

  const status = (repository: HistoryRepository, handle: string) => {
    const hit = statuses.get(handle);
    if (hit && Date.now() - hit.at < STATUS_TTL_MS) {
      return hit.value;
    }
    const value = repository
      .status(handle)
      .then((s) => ({ staging: s.staging, off: s.state === "off" }));
    statuses.set(handle, { at: Date.now(), value });
    value.catch(() => statuses.delete(handle));
    return value;
  };

  return {
    beforeOutsideChange(handle, path, revision, savedJson) {
      const repository = getRepository();
      if (!repository) {
        return;
      }
      void (async () => {
        // Keeping the pre-change state truly needs history: start a pending one.
        await repository.start?.(handle);
        const s = await status(repository, handle);
        if (s.staging || s.off) {
          return;
        }
        await repository.snapshotBytes(
          handle,
          path,
          "before-outside-change",
          revision,
          savedJson,
        );
      })().catch(swallow);
    },

    async beforeDiscard(handle, path, json) {
      const repository = getRepository();
      if (!repository) {
        return;
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const send = (async () => {
        const s = await status(repository, handle).catch(() => null);
        if (s?.off) {
          return;
        }
        const revision = await sha256Hex(json);
        await repository.snapshotBytes(
          handle,
          path,
          "discarded-edits",
          revision,
          json,
        );
      })().catch(swallow);
      const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      });
      await Promise.race([send, timeout]);
      clearTimeout(timer);
    },
  };
}
