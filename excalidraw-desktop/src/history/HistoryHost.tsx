/**
 * The single mount point of file history inside the app shell. It owns the
 * panel state, the checkpoint dialog and shared confirmation toasts, syncs the
 * native service (useHistorySync) and binds the app-level commands. The panel
 * (list, timeline, preview, restore) is one lazy chunk fetched on first open,
 * never prefetched: while history is closed nothing of it is loaded or running.
 */
import { memo, useCallback, useEffect, useRef, useState } from "react";

import { ConfirmModal } from "../components/ConfirmModal";
import { toastStore } from "../toasts/toastStore";
import { errorMessage } from "../vault/types";

import { PanelHost } from "../slots/PanelHost";

import { useStartMode } from "../services/useLazyServices";
import { useServiceStart } from "../services/useServiceStart";

import { CheckpointDialog } from "./CheckpointDialog";
import { publishHistoryBridge } from "./historyBridge";
import { HISTORY_PANEL_ID, publishHistoryPanelOpen } from "./historyPanelState";
import {
  deleteAllConfirm,
  drawingName,
  GIT_EXCLUDED_MESSAGE,
} from "./historyConfirms";
import { useHistoryCommands } from "./useHistoryCommands";
import { useHistorySync } from "./useHistorySync";

import "./history.css";

import type { SaveStatus } from "../vault/types";
import type { PanelMode, PanelNotice } from "./panel/HistoryPanel";
import type { HistoryRepository, HistorySettings } from "./types";

// The only import of the panel chunk: fetched on the first open, never before.
const loadHistoryPanel = () => import("./panel/HistoryPanel");

export interface HistoryHostProps {
  repository: HistoryRepository;
  vault: { handle: string; readOnly: boolean; path?: string } | null;
  /** Effective (global + per-vault) settings. */
  settings: HistorySettings;
  document: { id: string; path: string; revision: string } | null;
  /** Persists pending edits (the existing flush bridge). */
  flush: () => Promise<void>;
  ownerDocument?: Document | null;
  /** Save state of the open drawing (restore is refused on conflict/deleted). */
  status?: SaveStatus;
  /** The drawing was deleted outside the editor (not exposed by every caller). */
  deleted?: boolean;
  /** Opens a vault drawing (the "Restored as <name>" toast's Open button). */
  onOpenDrawing?: (path: string) => void;
  theme?: "light" | "dark";
  /** Native save for image exports of a version. */
  onSaveFile?: (fileName: string, bytes: Uint8Array) => Promise<unknown>;
}

const HistoryHostImpl = ({
  repository,
  vault,
  settings,
  document: activeDoc,
  flush,
  ownerDocument,
  status = "saved",
  deleted = false,
  onOpenDrawing,
  theme,
  onSaveFile,
}: HistoryHostProps) => {
  const [panelOpen, setPanelOpen] = useState(false);
  const [mode, setMode] = useState<PanelMode>("side");
  const saveRef = useRef({ status, deleted });
  saveRef.current = { status, deleted };
  const getSaveState = useCallback(() => saveRef.current, []);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);

  // history.start (D8): nothing is configured or versioned before the start;
  // "use" starts on the first history action or the first edit.
  const win = ownerDocument?.defaultView ?? null;
  const { started, activate } = useServiceStart(
    win,
    vault?.handle ?? null,
    useStartMode(win, "historyStart"),
    repository.start ? (h) => repository.start?.(h) : undefined,
  );
  useEffect(() => {
    if (panelOpen || dialogOpen || confirmDeleteAll || status !== "saved") {
      activate();
    }
  }, [activate, panelOpen, dialogOpen, confirmDeleteAll, status]);
  // Started natively (first save, a move, a history command): configure and
  // open it here too, so live settings and the open drawing reach it.
  useEffect(() => {
    if (!repository.onStarted || !vault?.handle) {
      return undefined;
    }
    const mine = vault.handle;
    let off: (() => void) | undefined;
    let disposed = false;
    repository
      .onStarted((h) => {
        if (h === mine) {
          activate();
        }
      })
      .then((unsubscribe) => {
        if (disposed) {
          unsubscribe();
        } else {
          off = unsubscribe;
        }
      })
      .catch(() => {});
    return () => {
      disposed = true;
      off?.();
    };
  }, [repository, vault?.handle, activate]);

  useHistorySync(repository, started ? vault : null, settings, activeDoc);

  const showToast = useCallback(
    (message: string, error = false, action?: PanelNotice["action"]) =>
      toastStore.push({ message, kind: error ? "error" : "info", action }),
    [],
  );
  const notify = useCallback(
    (message: string, notice?: PanelNotice) =>
      showToast(message, notice?.error ?? false, notice?.action),
    [showToast],
  );
  const handle = vault?.handle ?? null;
  const path = activeDoc?.path ?? null;
  const readOnly = vault?.readOnly ?? false;
  const canCheckpoint = !!handle && !!path && !readOnly;

  // No status read on vault open (it would sit on the vault-open path): the
  // command is offered in every writable vault and checks git when it runs.
  const canExclude = !!handle && !readOnly;

  useEffect(() => {
    publishHistoryBridge(
      handle ? { repository, handle, path, readOnly } : null,
    );
    return () => publishHistoryBridge(null);
  }, [repository, handle, path, readOnly]);

  const excludeFromGit = useCallback(async () => {
    if (!handle) {
      return;
    }
    try {
      await repository.start?.(handle);
      const status = await repository.status(handle);
      if (!status.gitRepo) {
        showToast("This vault is not a git repository");
        return;
      }
      if (status.gitExcluded) {
        showToast("History is already excluded from git");
        return;
      }
      await repository.excludeFromGit(handle);
      showToast(GIT_EXCLUDED_MESSAGE);
    } catch (cause) {
      showToast(errorMessage(cause), true);
    }
  }, [handle, repository, showToast]);

  const deleteAll = useCallback(async () => {
    setConfirmDeleteAll(false);
    if (!handle || !path) {
      return;
    }
    try {
      await repository.deleteAll(handle, path);
      showToast(`Deleted all history of ${drawingName(path)}`);
    } catch (cause) {
      showToast(errorMessage(cause), true);
    }
  }, [handle, path, repository, showToast]);

  useHistoryCommands({
    checkpoint: () => {
      if (canCheckpoint) {
        setDialogOpen(true);
      }
    },
    toggle: () => {
      setMode("side");
      setPanelOpen((open) => !open);
    },
    timeTravel: () => {
      setMode("fullscreen");
      setPanelOpen(true);
    },
    deleteAll:
      handle && path && !readOnly ? () => setConfirmDeleteAll(true) : undefined,
    excludeFromGit: canExclude ? () => void excludeFromGit() : undefined,
  });

  // The panel and dialog belong to one drawing: closing it closes them.
  useEffect(() => {
    if (!path) {
      setPanelOpen(false);
      setDialogOpen(false);
      setConfirmDeleteAll(false);
    }
  }, [path]);

  const focusCanvas = useCallback(() => {
    ownerDocument
      ?.querySelector<HTMLElement>(".vault-editor .excalidraw-container")
      ?.focus({ preventScroll: true });
  }, [ownerDocument]);

  // The shared dialog hands focus back to its opener; when that is gone (a
  // closed palette) nothing holds focus, so land on the canvas instead.
  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    setTimeout(() => {
      const doc = ownerDocument ?? globalThis.document;
      if (!doc.activeElement || doc.activeElement === doc.body) {
        focusCanvas();
      }
    }, 0);
  }, [focusCanvas, ownerDocument]);

  const saveCheckpoint = useCallback(
    async (name: string, note: string) => {
      if (!handle || !path) {
        return;
      }
      await flush();
      await repository.checkpoint(handle, path, name, note);
      closeDialog();
      showToast(`Checkpoint saved: ${name}`);
    },
    [closeDialog, flush, handle, path, repository, showToast],
  );

  const showing = panelOpen && !!handle && !!path;
  useEffect(() => {
    publishHistoryPanelOpen(showing);
  }, [showing]);
  useEffect(() => () => publishHistoryPanelOpen(false), []);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    focusCanvas();
  }, [focusCanvas]);

  return (
    <>
      {handle && path && (
        <PanelHost
          id={HISTORY_PANEL_ID}
          load={loadHistoryPanel}
          open={showing}
          onClose={closePanel}
          props={{
            repository,
            handle,
            path,
            documentId: activeDoc?.id,
            onClose: closePanel,
            mode,
            onModeChange: setMode,
            theme,
            readOnly: vault?.readOnly,
            vaultKey: vault?.path,
            highlightChanges: settings.highlightChanges,
            saveState: getSaveState,
            flush,
            notify,
            onOpenDrawing,
            onSaveFile,
            ownerDocument,
          }}
        />
      )}
      {dialogOpen && (
        <CheckpointDialog
          onSave={saveCheckpoint}
          onCancel={closeDialog}
          drawingName={path ? drawingName(path) : undefined}
        />
      )}
      {confirmDeleteAll && path && (
        <ConfirmModal
          {...deleteAllConfirm(path)}
          onConfirm={() => void deleteAll()}
          onCancel={() => setConfirmDeleteAll(false)}
        />
      )}
    </>
  );
};

/** Memoised: re-renders only when a prop changes (the shell re-renders often). */
export const HistoryHost = memo(HistoryHostImpl);
