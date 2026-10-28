import {
  desktopRepository,
  VaultError,
  type EventCallback,
  type InvokeFn,
  type ListenFn,
} from "../vault/DesktopVaultRepository";
import { errorMessage } from "../vault/types";

import type {
  LibraryChange,
  LibraryReadResult,
  LibraryRepository,
  LibraryScope,
} from "./types";

const normalizeError = (cause: unknown): Error => {
  if (cause instanceof Error) {
    return cause;
  }
  if (cause && typeof cause === "object") {
    const { code, message } = cause as { code?: unknown; message?: unknown };
    return new VaultError(
      typeof code === "string" ? code : "LIBRARY_ERROR",
      typeof message === "string" ? message : errorMessage(cause),
    );
  }
  return new Error(errorMessage(cause));
};

export interface DesktopLibraryRepositoryOptions {
  invoke?: InvokeFn;
  listen?: ListenFn;
  exportFile?: (name: string, bytes: Uint8Array) => Promise<boolean>;
}

/** Tauri bridge for the persisted library commands (see src-tauri library.rs). */
export class DesktopLibraryRepository implements LibraryRepository {
  constructor(private readonly options: DesktopLibraryRepositoryOptions = {}) {}

  private async call<T>(cmd: string, args?: Record<string, unknown>) {
    try {
      const invoke =
        this.options.invoke ??
        ((await import("@tauri-apps/api/core")).invoke as InvokeFn);
      return await invoke<T>(cmd, args);
    } catch (err) {
      throw normalizeError(err);
    }
  }

  readLibrary(
    scope: LibraryScope,
    handle: string | null,
    knownRevision: string | null,
    name: string | null = null,
  ) {
    return this.call<LibraryReadResult>("read_library", {
      scope,
      handle,
      knownRevision,
      name,
    });
  }

  writeLibrary(
    scope: LibraryScope,
    handle: string | null,
    json: string,
    expectedRevision: string | null,
    name: string | null = null,
  ) {
    return this.call<{ revision: string }>("write_library", {
      scope,
      handle,
      json,
      expectedRevision,
      name,
    });
  }

  listLibraries(scope: LibraryScope, handle: string | null) {
    return this.call<string[]>("list_libraries", { scope, handle });
  }

  async createLibrary(scope: LibraryScope, handle: string | null, name: string) {
    await this.call("create_library", { scope, handle, name });
  }

  async renameLibrary(
    scope: LibraryScope,
    handle: string | null,
    name: string,
    newName: string,
  ) {
    await this.call("rename_library", { scope, handle, name, newName });
  }

  async deleteLibrary(scope: LibraryScope, handle: string | null, name: string) {
    await this.call("delete_library", { scope, handle, name });
  }

  pickLibraryFile() {
    return this.call<{ name: string; json: string } | null>(
      "pick_library_file",
    );
  }

  exportFile(name: string, bytes: Uint8Array) {
    return (this.options.exportFile ?? desktopRepository.exportFile)(
      name,
      bytes,
    );
  }

  async subscribe(listener: (event: LibraryChange) => void) {
    try {
      const listen =
        this.options.listen ??
        ((await import("@tauri-apps/api/event")).listen as ListenFn);
      return await listen<LibraryChange>(
        "library-change",
        (event: Parameters<EventCallback<LibraryChange>>[0]) =>
          listener(event.payload),
      );
    } catch {
      // Outside the desktop shell there is nothing to listen to.
      return () => {};
    }
  }
}

export const desktopLibraryRepository = new DesktopLibraryRepository();
