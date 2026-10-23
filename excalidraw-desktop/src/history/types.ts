/**
 * File history: frozen frontend contract (PLAN §2.4). Rust implements the
 * matching `history_*` commands; `DesktopHistoryRepository` and the test fake
 * both implement `HistoryRepository`.
 */
export type HistoryReason =
  | "auto"
  | "leave"
  | "checkpoint"
  | "before-outside-change"
  | "before-restore"
  | "before-clear"
  | "first"
  | "recovered"
  | "discarded-edits"
  | "moved"
  | "unknown";

export interface VersionInfo {
  id: string;
  lineage: string;
  createdAt: number;
  device: string;
  ownDevice: boolean;
  reason: HistoryReason;
  name: string | null;
  note: string | null;
  kind: "keyframe" | "delta";
  sizeBytes: number;
  elementCount: number | null;
  availability: "local" | "downloading" | "missing";
  headerLoaded: boolean;
}

export interface HistoryListing {
  path: string;
  lineages: string[];
  /** Newest first, union of the path's lineages. */
  versions: VersionInfo[];
  lastVersionAt: number | null;
  enabled: boolean;
  readOnly: boolean;
  formatNewer: boolean;
}

export interface HistorySettings {
  enabled: boolean;
  intervalMinutes: number;
  keepAllHours: number;
  keepHourlyHours: number;
  keepDailyDays: number;
  keepWeeklyWeeks: number;
  sizeCapMb: number;
  highlightChanges: boolean;
}

export interface HistoryStatus {
  handle: string;
  state: "idle" | "writing" | "off" | "read-only" | "error";
  totalBytes: number;
  capBytes: number;
  checkpointBytes: number;
  overCap: "none" | "checkpoints" | "other-devices";
  staging: boolean;
  gcBlocked: boolean;
  formatNewer: boolean;
  gitRepo: boolean;
  /** The vault's .gitignore already excludes the history folder. */
  gitExcluded: boolean;
  lastError: { code: string; message: string } | null;
}

export interface SnapshotOutcome {
  id: string | null;
  skipped: string | null;
}

export interface HistoryChange {
  handle: string;
  paths: string[];
}

export interface HistoryRepository {
  /**
   * Starts the native history now if it is still pending (`history.start`
   * idle or use). Optional: any other history call starts it too.
   */
  start?(handle: string): Promise<void>;
  configure(handle: string, settings: HistorySettings): Promise<void>;
  status(handle: string): Promise<HistoryStatus>;
  /** The editor now shows `path` (null = no drawing). Never during autosave. */
  opened(
    handle: string,
    path: string | null,
    revision: string | null,
  ): Promise<void>;
  list(handle: string, path: string): Promise<HistoryListing>;
  snapshot(
    handle: string,
    path: string,
    reason: "leave" | "before-restore",
    wait: boolean,
  ): Promise<SnapshotOutcome>;
  snapshotBytes(
    handle: string,
    path: string,
    reason: "before-outside-change" | "discarded-edits",
    revision: string,
    json: string,
  ): Promise<SnapshotOutcome>;
  checkpoint(
    handle: string,
    path: string,
    name: string,
    note: string,
  ): Promise<VersionInfo>;
  readVersion(
    handle: string,
    id: string,
  ): Promise<{
    meta: { id: string; fileRevision: string; exact: boolean };
    json: string;
  }>;
  readBlob(handle: string, blob: string): Promise<Uint8Array>;
  restoreCopy(
    handle: string,
    id: string,
  ): Promise<{ path: string; revision: string }>;
  exportFile(handle: string, id: string): Promise<boolean>;
  deleteCheckpoint(handle: string, id: string): Promise<void>;
  deleteAll(handle: string, path: string): Promise<void>;
  excludeFromGit(handle: string): Promise<void>;
  subscribe(cb: (event: HistoryChange) => void): Promise<() => void>;
}

/** NativeError codes of the history commands. */
export const HISTORY_ERROR_CODES = [
  "HISTORY_OFF",
  "HISTORY_READ_ONLY",
  "HISTORY_FORMAT_NEWER",
  "HISTORY_DISK_LOW",
  "VERSION_GONE",
  "VERSION_DOWNLOADING",
  "VERSION_CORRUPT",
  "REVISION_MISMATCH",
] as const;
export type HistoryErrorCode = typeof HISTORY_ERROR_CODES[number];

export const CHECKPOINT_NAME_MAX = 120;
export const CHECKPOINT_NOTE_MAX = 2000;
