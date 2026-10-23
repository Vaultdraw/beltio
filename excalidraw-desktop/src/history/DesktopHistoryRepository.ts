import {
  normalizeError,
  resolveInvoke,
  resolveListen,
  VaultError,
} from "../vault/DesktopVaultRepository";

import type { InvokeFn, ListenFn } from "../vault/DesktopVaultRepository";

import type {
  HistoryChange,
  HistoryListing,
  HistoryRepository,
  HistorySettings,
  HistoryStatus,
  SnapshotOutcome,
  VersionInfo,
} from "./types";

export interface DesktopHistoryRepositoryOptions {
  invoke?: InvokeFn;
  listen?: ListenFn;
}

const NEWLINE = 0x0a;

/** Splits `<meta JSON>\n<stripped JSON>` (the meta JSON never contains a raw newline). */
export function decodeVersionFrame(buffer: ArrayBuffer | Uint8Array) {
  const bytes =
    buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer ?? []);
  const split = bytes.indexOf(NEWLINE);
  if (split < 0) {
    throw new VaultError("VERSION_CORRUPT", "Malformed version response");
  }
  const decoder = new TextDecoder();
  let meta: { id: string; fileRevision: string; exact: boolean };
  try {
    meta = JSON.parse(decoder.decode(bytes.subarray(0, split)));
  } catch {
    throw new VaultError("VERSION_CORRUPT", "Malformed version header");
  }
  return { meta, json: decoder.decode(bytes.subarray(split + 1)) };
}

/** Bridges the renderer to the native history service (`history_*` commands). */
export class DesktopHistoryRepository implements HistoryRepository {
  constructor(private readonly options: DesktopHistoryRepositoryOptions = {}) {}

  private async call<T>(
    command: string,
    args?: Record<string, unknown> | Uint8Array,
    options?: { headers?: Record<string, string> },
  ): Promise<T> {
    const invoke = await resolveInvoke(this.options.invoke);
    try {
      return await invoke<T>(command, args, options);
    } catch (err) {
      throw normalizeError(err);
    }
  }

  async start(handle: string): Promise<void> {
    await this.call("services_start", { handle, service: "history" });
  }

  async configure(handle: string, settings: HistorySettings): Promise<void> {
    await this.call<void>("history_configure", { handle, settings });
  }

  status(handle: string): Promise<HistoryStatus> {
    return this.call("history_status", { handle });
  }

  async opened(
    handle: string,
    path: string | null,
    revision: string | null,
  ): Promise<void> {
    await this.call<void>("history_opened", { handle, path, revision });
  }

  list(handle: string, path: string): Promise<HistoryListing> {
    return this.call("history_list", { handle, path });
  }

  snapshot(
    handle: string,
    path: string,
    reason: "leave" | "before-restore",
    wait: boolean,
  ): Promise<SnapshotOutcome> {
    return this.call("history_snapshot", { handle, path, reason, wait });
  }

  snapshotBytes(
    handle: string,
    path: string,
    reason: "before-outside-change" | "discarded-edits",
    revision: string,
    json: string,
  ): Promise<SnapshotOutcome> {
    return this.call("history_snapshot_bytes", new TextEncoder().encode(json), {
      headers: {
        "x-handle": encodeURIComponent(handle),
        "x-path": encodeURIComponent(path),
        "x-reason": encodeURIComponent(reason),
        "x-revision": encodeURIComponent(revision),
      },
    });
  }

  checkpoint(
    handle: string,
    path: string,
    name: string,
    note: string,
  ): Promise<VersionInfo> {
    return this.call("history_checkpoint", { handle, path, name, note });
  }

  async readVersion(handle: string, id: string) {
    const framed = await this.call<ArrayBuffer>("history_read_version", {
      handle,
      id,
    });
    return decodeVersionFrame(framed);
  }

  async readBlob(handle: string, blob: string): Promise<Uint8Array> {
    const raw = await this.call<ArrayBuffer | Uint8Array>("history_read_blob", {
      handle,
      blob,
    });
    return raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  }

  restoreCopy(handle: string, id: string) {
    return this.call<{ path: string; revision: string }>(
      "history_restore_copy",
      { handle, id },
    );
  }

  exportFile(handle: string, id: string): Promise<boolean> {
    return this.call("history_export_file", { handle, id });
  }

  async deleteCheckpoint(handle: string, id: string): Promise<void> {
    await this.call<void>("history_delete_checkpoint", { handle, id });
  }

  async deleteAll(handle: string, path: string): Promise<void> {
    await this.call<void>("history_delete_all", { handle, path });
  }

  async excludeFromGit(handle: string): Promise<void> {
    await this.call<void>("history_exclude_from_git", { handle });
  }

  async subscribe(cb: (event: HistoryChange) => void) {
    const listen = await resolveListen(this.options.listen);
    try {
      return await listen<{ handle: string; paths: string[] }>(
        "history-change",
        (event) =>
          cb({ handle: event.payload.handle, paths: event.payload.paths }),
      );
    } catch (err) {
      throw normalizeError(err);
    }
  }
}

export const desktopHistoryRepository = new DesktopHistoryRepository();
