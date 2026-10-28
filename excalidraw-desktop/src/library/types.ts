/** `folder`: a directory from `[library] folders` (the handle is its path). */
export type LibraryScope = "personal" | "vault" | "folder";

export type LibraryReadResult = {
  /** null when the file does not exist, or when `unchanged` is true. */
  json: string | null;
  /** null when the file does not exist. */
  revision: string | null;
  /** The caller's knownRevision is still current: nothing was transferred. */
  unchanged: boolean;
  path: string;
  readOnly: boolean;
};

export type LibraryChange = { scope: LibraryScope; handle?: string };

export interface LibraryRepository {
  readLibrary(
    scope: LibraryScope,
    handle: string | null,
    knownRevision: string | null,
    /** null = the scope's default library file. */
    name?: string | null,
  ): Promise<LibraryReadResult>;
  /** expectedRevision null = create only. Rejects with code CONFLICT on mismatch. */
  writeLibrary(
    scope: LibraryScope,
    handle: string | null,
    json: string,
    expectedRevision: string | null,
    name?: string | null,
  ): Promise<{ revision: string }>;
  /** Names of the named libraries of a scope (not the default file). */
  listLibraries?(scope: LibraryScope, handle: string | null): Promise<string[]>;
  createLibrary?(
    scope: LibraryScope,
    handle: string | null,
    name: string,
  ): Promise<void>;
  renameLibrary?(
    scope: LibraryScope,
    handle: string | null,
    name: string,
    newName: string,
  ): Promise<void>;
  /** Moves the file into a `.removed` folder next to it (recoverable). */
  deleteLibrary?(
    scope: LibraryScope,
    handle: string | null,
    name: string,
  ): Promise<void>;
  /** null = cancelled. */
  pickLibraryFile(): Promise<{ name: string; json: string } | null>;
  exportFile(name: string, bytes: Uint8Array): Promise<boolean>;
  subscribe(listener: (event: LibraryChange) => void): Promise<() => void>;
}
