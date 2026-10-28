/** Why a vault opened read-only (reported by the native side). */
export type ReadOnlyReason =
  | "notWritable"
  | "lockedByOtherProcess"
  | "lockUnavailable";

export type VaultInfo = {
  handle: string;
  path: string;
  name: string;
  readOnly: boolean;
  readOnlyReason?: ReadOnlyReason | null;
  /** The other Vaultdraw process holding the lock (lockedByOtherProcess). */
  lockHolderPid?: number | null;
  /** Linux: the native file watcher could not start, so the vault is polled instead (the app tells the user once). */
  watchFallback?: WatchFallback | null;
};

export type WatchFallback = {
  /** `limitReached`: the inotify watch limit; `failed`: another start error. */
  reason: "limitReached" | "failed";
  intervalMs: number;
};

/** What the tree lists: folders, drawings (`.excalidraw`), Markdown notes and Obsidian Excalidraw files (`.excalidraw.md`). */
export type EntryKind = "folder" | "drawing" | "note" | "excalidrawMd";

export type VaultEntry = {
  path: string;
  name: string;
  kind: EntryKind;
  modifiedAt: number;
  size: number;
  /** Sync-service state: a conflict copy, or an iCloud file that is not downloaded yet. */
  sync?: "conflict" | "placeholder";
  /** For a conflict copy: the path of the file it conflicts with. */
  conflictOf?: string;
};

/** `readOnly`: the file has no write permission (or is locked); the editor opens it in view mode. */
export type DrawingFile = {
  json: string;
  revision: string;
  readOnly?: boolean;
};
export type RecoveryEntry = {
  id: string;
  path: string;
  modifiedAt: number;
  json: string;
};
export type VaultChange = { handle: string; paths: string[]; rescan: boolean };
export type SaveStatus = "saved" | "dirty" | "saving" | "conflict" | "error";

export interface VaultRepository {
  chooseVault(create?: boolean): Promise<VaultInfo | null>;
  reopenVault(): Promise<VaultInfo | null>;
  releaseVault(handle: string): Promise<void>;
  /** Opens the vault behind `handle` again as a new handle (writable if its lock is free now). */
  retryVault?(handle: string): Promise<VaultInfo>;
  listDirectory(handle: string, path: string): Promise<VaultEntry[]>;
  readDrawing(handle: string, path: string): Promise<DrawingFile>;
  /** Cheap revision probe (no content transfer); null when the file is missing. */
  readRevision?(handle: string, path: string): Promise<string | null>;
  /** Cheap probe: is the drawing file read-only now? The open drawing re-checks it on a change event to lift its banner. */
  readOnlyState?(handle: string, path: string): Promise<boolean>;
  writeDrawing(input: {
    handle: string;
    path: string;
    json: string;
    expectedRevision: string | null;
    operationId: string;
  }): Promise<{ revision: string }>;
  createFolder(handle: string, path: string): Promise<void>;
  move(handle: string, from: string, to: string): Promise<void>;
  trash(handle: string, path: string): Promise<void>;
  /** Files under a folder, counted natively and capped at 1,000 (for the Trash confirmation). */
  countFolderItems?(handle: string, path: string): Promise<FolderCount>;
  /** Asks iCloud to download a file listed as `sync: "placeholder"`; returns at once. */
  downloadPlaceholder?(handle: string, path: string): Promise<void>;
  reveal(handle: string, path: string): Promise<void>;
  /** Opens the vault's crash-recovery folder in the OS file manager. */
  revealRecovery(handle: string): Promise<void>;
  exportFile(name: string, bytes: Uint8Array): Promise<boolean>;
  /** Copies a drawing's bytes, unchanged, to a place picked in the save
   *  dialog. false = cancelled. */
  saveDrawingCopy(handle: string, path: string): Promise<boolean>;
  listRecovery(handle: string): Promise<RecoveryEntry[]>;
  discardRecovery(handle: string, id: string): Promise<void>;
  subscribe(listener: (event: VaultChange) => void): Promise<() => void>;
}

export const joinPath = (parent: string, name: string) =>
  parent ? `${parent}/${name}` : name;

/** A vault error with the native NOT_FOUND code (the path does not exist). */
export const isNotFoundError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as { code?: unknown }).code === "NOT_FOUND";

export const errorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "object" && error && "message" in error) {
    return String(error.message);
  }
  return String(error);
};

/** How many files a folder holds; `capped` means "this many or more". */
export interface FolderCount {
  count: number;
  capped: boolean;
}
