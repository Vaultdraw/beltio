/**
 * Vault backup and restore from the app: the native side picks the folders and does the work
 * in the background (`backup_start`, `restore_start`); this polls its progress about twice a
 * second and shows it as one toast with a Cancel button. Nothing here runs until a command is
 * used. The files are written by Rust (`vaultdraw_core::backup`); the vault is only read and a
 * restore only creates a new folder.
 */
import { nativeCall } from "../vault/settingsSync";
import { toastStore } from "../toasts/toastStore";

import type { ToastInput } from "../toasts/queue";

export interface BackupStatus {
  kind: "backup" | "restore" | "";
  running: boolean;
  phase: string;
  filesDone: number;
  filesTotal: number;
  bytesDone: number;
  bytesTotal: number;
  path: string | null;
  files: number | null;
  error: { code: string; message: string } | null;
}

const POLL_MS = 500;
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const progressMessage = (s: BackupStatus): string => {
  const what = s.kind === "restore" ? "Restoring" : "Backing up";
  if (s.phase === "verifying") {
    return "Checking the backup against the vault…";
  }
  const pct = s.bytesTotal
    ? Math.min(100, Math.floor((s.bytesDone / s.bytesTotal) * 100))
    : 0;
  return `${what}… ${pct}% (${s.filesDone} of ${s.filesTotal} files)`;
};

let shownId: number | null = null;
const show = (message: string, input: Omit<ToastInput, "message"> = {}) => {
  if (shownId !== null) {
    toastStore.dismiss(shownId);
  }
  toastStore.push({ message, ...input });
  shownId = toastStore.getSnapshot().toasts.at(-1)?.id ?? null;
};

const cancel = () => void nativeCall("Backup", "backup_cancel").catch(() => {});

/** Polls until the job ends, then shows the outcome. `onDone` gets the finished status. */
async function follow(onDone: (s: BackupStatus) => void): Promise<void> {
  for (;;) {
    const s = await nativeCall<BackupStatus>("Backup", "backup_status");
    if (s.running) {
      show(progressMessage(s), {
        durationMs: 2 * POLL_MS + 1000,
        action: { label: "Cancel", run: cancel },
      });
      await new Promise((r) => setTimeout(r, POLL_MS));
      continue;
    }
    onDone(s);
    return;
  }
}

const failed = (what: string, s: BackupStatus) =>
  show(
    s.error?.code === "CANCELLED"
      ? `${what} cancelled; nothing was kept.`
      : `${what} failed: ${s.error?.message ?? "unknown error"}`,
    { kind: s.error?.code === "CANCELLED" ? "info" : "error" },
  );

/** "Back up vault…": asks for a folder, then writes `<vault> backup <date>.zip` there. */
export async function runBackup(handle: string): Promise<void> {
  try {
    const folder = await nativeCall<string | null>("Backup", "backup_start", {
      handle,
    });
    if (folder === null) {
      return;
    }
    await follow((s) =>
      s.error
        ? failed("Backup", s)
        : show(`Backup written: ${s.path} (${s.files} files)`, {
            durationMs: 15000,
          }),
    );
  } catch (e) {
    show(`Backup failed: ${errorText(e)}`, { kind: "error" });
  }
}

/** "Restore from backup…": asks for a zip and a folder; restores into a new folder, then offers to open it. */
export async function runRestore(
  openVault: (path: string) => Promise<unknown>,
): Promise<void> {
  try {
    const folder = await nativeCall<string | null>("Backup", "restore_start");
    if (folder === null) {
      return;
    }
    await follow((s) =>
      s.error || !s.path
        ? failed("Restore", s)
        : show(`Restored ${s.files} files into ${s.path}`, {
            durationMs: 30000,
            action: {
              label: "Open as vault",
              run: () =>
                void openVault(s.path as string).catch((e) =>
                  show(`Could not open it: ${errorText(e)}`, { kind: "error" }),
                ),
            },
          }),
    );
  } catch (e) {
    show(`Restore failed: ${errorText(e)}`, { kind: "error" });
  }
}
