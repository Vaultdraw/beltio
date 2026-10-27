import {
  normalizeError,
  resolveInvoke,
  VaultError,
} from "../vault/DesktopVaultRepository";

import type { InvokeFn } from "../vault/DesktopVaultRepository";

/**
 * The guarded way to read and change a Markdown note (`.md`) in the vault. The native side
 * (`read_note`, `write_note`) checks the revision, keeps a history copy, and replaces the file
 * atomically; nothing else in the app writes a note.
 *
 * Paths are vault-relative with forward slashes, end in `.md` (not `.excalidraw.md`) and have no
 * component starting with ".".
 */
export interface NoteFile {
  content: string;
  /** Hex SHA-256 of the file's bytes: pass it back to `writeNote`. */
  revision: string;
  mtimeMs: number;
  size: number;
}

export interface NoteWritten {
  revision: string;
  bytes: number;
  mtimeMs: number;
  /** Vault-relative path of the copy of the previous text; null for a new or unchanged note. */
  historyCopy: string | null;
}

/** The file changed on disk since it was read (edited elsewhere, e.g. in Obsidian). Re-read; never overwrite. */
export class NoteConflictError extends VaultError {
  constructor(message = "Note changed on disk; save was not applied") {
    super("CONFLICT", message);
    this.name = "NoteConflictError";
  }
}

export interface NoteFiles {
  read(handle: string, path: string): Promise<NoteFile>;
  /** `expectedRevision` null creates a new note and never replaces an existing one. */
  write(
    handle: string,
    path: string,
    content: string,
    expectedRevision: string | null,
  ): Promise<NoteWritten>;
}

export class DesktopNoteFiles implements NoteFiles {
  constructor(private readonly invokeFn?: InvokeFn) {}

  private async call<T>(
    command: string,
    args: Record<string, unknown>,
  ): Promise<T> {
    const invoke = await resolveInvoke(this.invokeFn);
    try {
      return await invoke<T>(command, args);
    } catch (err) {
      const e = normalizeError(err);
      if (e instanceof VaultError && e.code === "CONFLICT") {
        throw new NoteConflictError(e.message);
      }
      throw e;
    }
  }

  read(handle: string, path: string): Promise<NoteFile> {
    return this.call("read_note", { handle, path });
  }

  write(
    handle: string,
    path: string,
    content: string,
    expectedRevision: string | null,
  ): Promise<NoteWritten> {
    return this.call("write_note", {
      handle,
      path,
      content,
      expectedRevision,
    });
  }
}

const desktop = new DesktopNoteFiles();

export const readNote = (
  handle: string,
  path: string,
  files: NoteFiles = desktop,
) => files.read(handle, path);

export const writeNote = (
  handle: string,
  path: string,
  content: string,
  expectedRevision: string | null,
  files: NoteFiles = desktop,
) => files.write(handle, path, content, expectedRevision);
