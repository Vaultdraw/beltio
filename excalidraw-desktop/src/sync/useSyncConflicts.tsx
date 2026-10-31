/**
 * Binds the `sync.*` commands, the tree's compare and download actions, and owns the compare
 * dialog. Nothing is loaded until one of them runs (the dialog is a lazy chunk).
 */
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { registerCommandHandlers } from "../commands/handlerRegistry";
import { SYNC_COMMAND_IDS } from "../commands/syncCommands";
import { toastStore } from "../toasts/toastStore";
import { cachedPreferences } from "../vault/useGlobalPref";
import { errorMessage } from "../vault/types";

import { findCounterpart, resolveConflict } from "./resolveConflict";

import type { HistoryRepository } from "../history/types";
import type { VaultEntry, VaultInfo, VaultRepository } from "../vault/types";
import type { Keep } from "./resolveConflict";

const SyncCompareDialog = lazy(() =>
  import("./SyncCompareDialog").then((m) => ({ default: m.SyncCompareDialog })),
);

const dirOf = (path: string) =>
  path.slice(0, Math.max(0, path.lastIndexOf("/")));
const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** `open`: a click on a file row; `download` / `compare`: the row menu. */
export type SyncAction = "compare" | "download" | "open";

interface Options {
  repository: VaultRepository;
  history: HistoryRepository;
  /** null before a vault opens. */
  vault: VaultInfo | null;
  /** The open drawing, if any. */
  activePath: string | null;
  theme: "light" | "dark";
  openDrawing: (path: string) => unknown;
}

export function useSyncConflicts({
  repository,
  history,
  vault,
  activePath,
  theme,
  openDrawing,
}: Options) {
  const [pair, setPair] = useState<{ original: string; copy: string } | null>(
    null,
  );
  const live = useRef({ repository, history, vault, activePath, openDrawing });
  live.current = { repository, history, vault, activePath, openDrawing };

  const counterpartOf = useCallback(async (path: string) => {
    const { repository: r, vault: v } = live.current;
    if (!v) {
      return null;
    }
    const entries = await r.listDirectory(v.handle, dirOf(path));
    return findCounterpart(path, entries);
  }, []);

  const keep = useCallback(
    async (
      p: { original: string; copy: string },
      which: Keep,
      from: string | null,
    ) => {
      const {
        repository: r,
        history: h,
        vault: v,
        openDrawing: open,
      } = live.current;
      if (!v) {
        return;
      }
      await resolveConflict({
        repository: r,
        history: h,
        handle: v.handle,
        original: p.original,
        copy: p.copy,
        keep: which,
      });
      toastStore.push({
        message:
          which === "original"
            ? `Kept ${baseName(
                p.original,
              )}. The conflict copy is in History and the Trash.`
            : `Kept the conflict copy as ${baseName(
                p.original,
              )}. The old version is in History.`,
      });
      // The open drawing was the copy that just left: continue on the original.
      if (from === p.copy) {
        void open(p.original);
      }
    },
    [],
  );

  const download = useCallback(
    async (entry: Pick<VaultEntry, "path" | "name">) => {
      const { repository: r, vault: v } = live.current;
      if (!v || !r.downloadPlaceholder) {
        toastStore.push({
          message: "Downloading iCloud files is not available here.",
        });
        return;
      }
      try {
        await r.downloadPlaceholder(v.handle, entry.path);
        toastStore.push({
          message: `Asked iCloud to download ${entry.name}. It opens once it arrives.`,
        });
      } catch (e) {
        toastStore.push({
          message: `Could not download ${entry.name}: ${errorMessage(e)}`,
          kind: "error",
        });
      }
    },
    [],
  );

  /** Tree row actions. */
  const onSyncAction = useCallback(
    (entry: VaultEntry, action: SyncAction) => {
      if (action === "open") {
        // A placeholder has no content yet: never open it.
        if (cachedPreferences().syncDownloadPlaceholders) {
          void download(entry);
        } else {
          toastStore.push({
            message: `${entry.name} is not downloaded. Use Download from iCloud in its menu.`,
          });
        }
      } else if (action === "download") {
        void download(entry);
      } else if (entry.sync === "conflict" && entry.conflictOf) {
        setPair({ original: entry.conflictOf, copy: entry.path });
      } else {
        void counterpartOf(entry.path).then((p) => p && setPair(p));
      }
    },
    [download, counterpartOf],
  );

  useEffect(
    () =>
      registerCommandHandlers({
        [SYNC_COMMAND_IDS.compare]: async () => {
          const path = live.current.activePath;
          const p = path ? await counterpartOf(path) : null;
          if (p) {
            setPair(p);
          } else {
            toastStore.push({
              message: "No conflict copy found for this drawing.",
            });
          }
        },
        [SYNC_COMMAND_IDS.keepThis]: async () => {
          const path = live.current.activePath;
          const p = path ? await counterpartOf(path) : null;
          if (!path || !p) {
            toastStore.push({
              message: "No conflict copy found for this drawing.",
            });
            return;
          }
          await keep(p, path === p.original ? "original" : "copy", path).catch(
            (e) =>
              toastStore.push({
                message: `Could not keep this version: ${errorMessage(e)}`,
                kind: "error",
              }),
          );
        },
        [SYNC_COMMAND_IDS.keepOther]: async () => {
          const path = live.current.activePath;
          const p = path ? await counterpartOf(path) : null;
          if (!path || !p) {
            toastStore.push({
              message: "No conflict copy found for this drawing.",
            });
            return;
          }
          await keep(p, path === p.original ? "copy" : "original", path).catch(
            (e) =>
              toastStore.push({
                message: `Could not keep the other version: ${errorMessage(e)}`,
                kind: "error",
              }),
          );
        },
      }),
    [counterpartOf, keep],
  );

  const dialog =
    pair && vault ? (
      <Suspense fallback={null}>
        <SyncCompareDialog
          repository={repository}
          handle={vault.handle}
          original={pair.original}
          copy={pair.copy}
          theme={theme}
          readOnly={vault.readOnly}
          onKeep={(which) => keep(pair, which, activePath)}
          onClose={() => setPair(null)}
        />
      </Suspense>
    ) : null;

  return { dialog, onSyncAction };
}
