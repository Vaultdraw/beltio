import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { getEditorApi } from "../../editor/editorApi";
import { errorMessage } from "../../vault/types";
import { ConfirmModal } from "../../components/ConfirmModal";
import { IconClose } from "../../components/Icons";
import { GitNotice } from "../GitNotice";
import {
  deleteCheckpointConfirm,
  drawingName,
  GIT_EXCLUDED_MESSAGE,
} from "../historyConfirms";
import { onHistoryPanelFocusRequest } from "../historyPanelState";
import { useHistoryStatus } from "../useHistoryStatus";

import { RestoreDialog } from "../RestoreDialog";
import {
  copySelectionInto,
  exportVersionFile,
  replaceRefusal,
  restoreCopy,
  restoreReplace,
  type ReplaceRefusal,
} from "../restore";
import { registerPurge } from "../../memory/purgeRegistry";
import { openImageExport } from "../preview/exportImage";
import { createVersionCache } from "../preview/versionCache";

import { HistoryWarnings } from "./HistoryWarnings";

import { PreviewOverlay } from "./PreviewOverlay";
import { Timeline } from "./Timeline";
import { VersionList } from "./VersionList";
import { createPanelThumbnails } from "./thumbnails";
import { useCheckpointDelete } from "./useCheckpointDelete";
import { usePanelCommands } from "./usePanelCommands";
import {
  formatClock,
  formatTime,
  relativeTime,
  versionLabel,
} from "./versionLabels";

import "./historyPanel.css";

import type { HistoryListing, HistoryRepository, VersionInfo } from "../types";
import type { LoadedVersion } from "../preview/versionCache";
import type { SaveStatus } from "../../vault/types";

// Re-exported for the H1 callers and tests that import them from here.
export { relativeTime, versionLabel };

export type PanelMode = "side" | "fullscreen";

export interface PanelNotice {
  error?: boolean;
  action?: { label: string; run: () => void };
}

export interface HistoryPanelProps {
  repository: HistoryRepository;
  handle: string;
  /** The open drawing (vault-relative). */
  path: string;
  /** Editor-API key of the open drawing; without it restore is unavailable. */
  documentId?: string;
  onClose: () => void;
  /** Controlled layout mode; the panel keeps its own when omitted. */
  mode?: PanelMode;
  onModeChange?: (mode: PanelMode) => void;
  theme?: "light" | "dark";
  readOnly?: boolean;
  /** Live save state of the drawing (for the replace refusal). */
  saveState?: () => { status: SaveStatus; deleted: boolean };
  flush?: () => Promise<void>;
  notify?: (message: string, notice?: PanelNotice) => void;
  onOpenDrawing?: (path: string) => void;
  /** Native save used by the preview's image export dialog. */
  onSaveFile?: (fileName: string, bytes: Uint8Array) => Promise<unknown>;
  ownerDocument?: Document | null;
  /** Key of per-vault UI state (the vault path); the handle when omitted. */
  vaultKey?: string;
  /** `history.highlight_changes`, passed on to the preview overlay. */
  highlightChanges?: boolean;
  /** The git state changed (the notice's Exclude button was used). */
  onGitChange?: () => void;
}

const PREVIEW_LIVE_MAX_ELEMENTS = 500;
const STATE_FALLBACK = { status: "saved" as SaveStatus, deleted: false };

const mainViewport = (documentId?: string) => {
  const s = documentId ? getEditorApi(documentId)?.getAppState() : undefined;
  return s
    ? { scrollX: s.scrollX, scrollY: s.scrollY, zoom: s.zoom.value }
    : null;
};

/** The open drawing's versions: list, timeline, preview and restore. */
const HistoryPanel = ({
  repository,
  handle,
  path,
  documentId,
  onClose,
  mode: controlledMode,
  onModeChange,
  theme = "light",
  readOnly = false,
  saveState = () => STATE_FALLBACK,
  flush = async () => {},
  notify = () => {},
  onOpenDrawing,
  onSaveFile,
  ownerDocument,
  vaultKey,
  highlightChanges = true,
  onGitChange,
}: HistoryPanelProps) => {
  const doc = ownerDocument ?? document;
  const [listing, setListing] = useState<HistoryListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [localMode, setLocalMode] = useState<PanelMode>("side");
  const mode = controlledMode ?? localMode;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<LoadedVersion | null>(null);
  const [selectionCount, setSelectionCount] = useState(0);
  const [dialog, setDialog] = useState<{ refusal: ReplaceRefusal } | null>(
    null,
  );
  const listRef = useRef<HTMLUListElement>(null);
  const generation = useRef(0);
  const previewApi = useRef<ExcalidrawImperativeAPI | null>(null);
  const viewport = useRef<ReturnType<typeof mainViewport>>(null);
  const busy = useRef(false);

  const cache = useMemo(
    () =>
      createVersionCache({
        repository,
        handle,
        mainFiles: () =>
          documentId ? getEditorApi(documentId)?.getFiles() : undefined,
      }),
    [repository, handle, documentId],
  );
  const thumbs = useMemo(
    () => createPanelThumbnails((id) => cache.json(id)),
    [cache],
  );
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  useEffect(() => {
    const unregister = [
      registerPurge("historyThumbnails", () => thumbs.clear()),
      registerPurge("historyVersions", () =>
        cache.purge(selectedIdRef.current),
      ),
    ];
    return () => {
      unregister.forEach((u) => u());
      thumbs.clear();
      cache.clear();
    };
  }, [cache, thumbs]);

  const { status, refresh: refreshStatus } = useHistoryStatus(
    repository,
    handle,
  );

  const refresh = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const next = await repository.list(handle, path);
      if (mine === generation.current) {
        setListing(next);
        setError(null);
        setNow(Date.now());
      }
    } catch (cause) {
      if (mine === generation.current) {
        setError(errorMessage(cause));
      }
    }
  }, [repository, handle, path]);

  useEffect(() => {
    setListing(null);
    void refresh();
    let off: (() => void) | undefined;
    let disposed = false;
    void repository
      .subscribe((event) => {
        if (event.handle === handle && event.paths.includes(path)) {
          void refresh();
          void refreshStatus();
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
      // The counter is a token, not a node: bumping it cancels late replies.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
      off?.();
    };
  }, [repository, handle, path, refresh, refreshStatus]);

  // Keep "N min ago" honest while the panel is open (the only timer).
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const focusList = () => listRef.current?.focus({ preventScroll: true });
    focusList();
    return onHistoryPanelFocusRequest(focusList);
  }, []);

  const versions = useMemo(() => listing?.versions ?? [], [listing]);
  const last = listing?.lastVersionAt ?? null;
  const selected: VersionInfo | null =
    versions.find((v) => v.id === selectedId) ?? null;

  // A version that vanished (retention, delete) ends the preview.
  useEffect(() => {
    if (selectedId && listing && !selected) {
      setSelectedId(null);
    }
  }, [selectedId, listing, selected]);

  // Load the selected version: scene first, images once the user settles.
  useEffect(() => {
    setSelectionCount(0);
    if (!selectedId) {
      setLoaded(null);
      return;
    }
    const ctl = new AbortController();
    const { signal } = ctl;
    const quick = cache.load(selectedId, { images: false, signal });
    quick
      .then((v) => !signal.aborted && setLoaded(v))
      .catch((cause) => {
        if (!signal.aborted) {
          notify(errorMessage(cause), { error: true });
        }
      });
    const settle = setTimeout(() => {
      cache
        .load(selectedId, { images: true, signal })
        .then((v) => !signal.aborted && setLoaded(v))
        .catch(() => {});
    }, 120);
    return () => {
      clearTimeout(settle);
      ctl.abort();
    };
    // `notify` is a per-render closure in the host; the load must not restart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, cache]);

  const select = useCallback(
    (id: string | null) => {
      if (id && !viewport.current) {
        viewport.current = mainViewport(documentId);
      }
      setSelectedId(id);
      if (!id) {
        viewport.current = null;
      }
    },
    [documentId],
  );

  const setMode = useCallback(
    (next: PanelMode) => {
      setLocalMode(next);
      onModeChange?.(next);
    },
    [onModeChange],
  );

  // Leaving the preview also leaves time travel, or it would reselect at once.
  // The timeline keeps its own focus (End/Home to "Current" then more keys).
  const backToCurrent = useCallback(
    (focusList = true) => {
      select(null);
      setMode("side");
      if (focusList) {
        listRef.current?.focus({ preventScroll: true });
      }
    },
    [select, setMode],
  );

  const step = useCallback(
    (delta: 1 | -1) => {
      const at = selectedId
        ? versions.findIndex((v) => v.id === selectedId)
        : -1;
      const to = at + delta;
      if (to < 0) {
        if (selectedId) {
          backToCurrent();
        }
      } else if (to < versions.length) {
        select(versions[to].id);
      }
    },
    [selectedId, versions, select, backToCurrent],
  );

  const labelOf = (v: VersionInfo) => versionLabel(v);

  const fail = (cause: unknown) => notify(errorMessage(cause), { error: true });

  const guarded = async (job: () => Promise<void>) => {
    if (busy.current) {
      return;
    }
    busy.current = true;
    try {
      await job();
    } catch (cause) {
      fail(cause);
    } finally {
      busy.current = false;
    }
  };

  const doReplace = () =>
    guarded(async () => {
      const api = documentId ? getEditorApi(documentId) : undefined;
      if (!selected || !api) {
        throw new Error("The drawing is not open in the editor.");
      }
      setDialog(null);
      const version = await cache.load(selected.id, { images: true });
      await restoreReplace(
        {
          repository,
          handle,
          path,
          flush,
          api,
          state: () => ({ ...saveState(), readOnly }),
        },
        version,
      );
      notify(
        `Restored version from ${formatClock(selected.createdAt)}. Undo: Cmd+Z`,
      );
      backToCurrent();
    });

  const doCopy = () =>
    guarded(async () => {
      if (!selected) {
        return;
      }
      setDialog(null);
      const made = await restoreCopy(repository, handle, selected.id);
      const name = made.path.split("/").pop() ?? made.path;
      notify(
        `Restored as ${name}`,
        onOpenDrawing
          ? { action: { label: "Open", run: () => onOpenDrawing(made.path) } }
          : undefined,
      );
    });

  const openDialog = () => {
    if (selected) {
      setDialog({ refusal: replaceRefusal({ ...saveState(), readOnly }) });
    }
  };

  const copySelection = () => {
    const main = documentId ? getEditorApi(documentId) : undefined;
    const preview = previewApi.current;
    if (!main || !preview || !loaded) {
      return;
    }
    try {
      const n = copySelectionInto(main, preview, loaded);
      notify(`Copied ${n} element${n === 1 ? "" : "s"} to the drawing`);
    } catch (cause) {
      fail(cause);
    }
  };

  const exportImage = () => {
    if (previewApi.current && loaded) {
      openImageExport(previewApi.current, loaded);
    }
  };

  usePanelCommands(
    {
      previous: () => step(1),
      next: () => step(-1),
      restore: openDialog,
      restoreReplace: doReplace,
      restoreCopy: doCopy,
      copySelection,
      exportExcalidraw: () =>
        guarded(async () => {
          if (selected) {
            await exportVersionFile(repository, handle, selected.id);
          }
        }),
      exportImage,
      // command audit (S8)
      backToCurrent: () => backToCurrent(),
    },
    { hasVersion: !!selected, hasSelection: selectionCount > 0 },
  );

  const checkpointDelete = useCheckpointDelete({
    repository,
    handle,
    versions,
    selected,
    readOnly,
    refresh: () => Promise.all([refresh(), refreshStatus()]).then(() => {}),
    notify,
  });

  const excludeFromGit = async () => {
    try {
      await repository.excludeFromGit(handle);
      notify(GIT_EXCLUDED_MESSAGE);
    } catch (cause) {
      fail(cause);
    }
    void refreshStatus();
    onGitChange?.();
  };

  // Scrubbing: a cached small scene may preview live; the rest waits to settle.
  const onScrub = useCallback(
    (id: string | null) => {
      const info = id ? versions.find((v) => v.id === id) : null;
      const cached = id ? cache.peek(id) : undefined;
      if (
        id &&
        info &&
        cached &&
        (info.elementCount ?? Infinity) <= PREVIEW_LIVE_MAX_ELEMENTS
      ) {
        select(id);
      }
    },
    [versions, cache, select],
  );

  // Time travel with nothing selected starts at the newest version.
  useEffect(() => {
    if (mode === "fullscreen" && !selectedId && versions.length > 0) {
      select(versions[0].id);
    }
  }, [mode, selectedId, versions, select]);

  const fullscreen = mode === "fullscreen" && !!selected;
  const timeline = (
    <Timeline
      versions={versions}
      selectedId={selectedId}
      thumbs={thumbs}
      onScrub={onScrub}
      onSettle={(id) => (id ? select(id) : backToCurrent(false))}
    />
  );
  const target =
    doc.querySelector<HTMLElement>(".vault-editor-pane") ?? doc.body;

  return (
    <aside
      className="vault-history-panel"
      aria-label="History"
      onKeyDown={(e) => {
        // The restore dialog owns its own Escape.
        if (e.key !== "Escape" || dialog || checkpointDelete.confirming) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        if (selectedId) {
          backToCurrent();
        } else {
          onClose();
        }
      }}
    >
      <div className="vault-history-panel__header">
        <h3 className="vault-history-panel__title">History</h3>
        <span className="vault-history-panel__header-actions">
          <button
            type="button"
            className="vault-btn vault-btn--ghost vault-btn--sm"
            data-testid="history-fullscreen"
            aria-pressed={mode === "fullscreen"}
            onClick={() =>
              setMode(mode === "fullscreen" ? "side" : "fullscreen")
            }
          >
            {mode === "fullscreen" ? "Exit time travel" : "Time travel"}
          </button>
          <button
            type="button"
            className="vault-btn vault-btn--ghost vault-btn--icon"
            onClick={onClose}
            aria-label="Close history"
          >
            <IconClose />
          </button>
        </span>
      </div>
      <p className="vault-history-panel__last" data-testid="history-last">
        {listing && !listing.enabled
          ? "History is off"
          : last === null
          ? "No versions yet"
          : `Last version: ${relativeTime(last, now)}`}
      </p>
      <GitNotice
        status={status}
        vaultKey={vaultKey ?? handle}
        disabled={readOnly}
        onExclude={excludeFromGit}
        ownerWindow={doc.defaultView}
      />
      <HistoryWarnings status={status} />
      {error && <div className="vault-error-text">{error}</div>}
      <VersionList
        versions={versions}
        selectedId={selectedId}
        thumbs={thumbs}
        listRef={listRef}
        onSelect={select}
        onStep={step}
        onEnter={openDialog}
        onDelete={readOnly ? undefined : checkpointDelete.request}
      />
      {versions.length > 0 && !fullscreen && timeline}
      {selected && (
        <PreviewOverlay
          target={target}
          fullscreen={fullscreen}
          version={loaded}
          title={labelOf(selected)}
          time={formatTime(selected.createdAt)}
          canCopy={selectionCount > 0 && !readOnly}
          initialViewport={viewport.current}
          theme={theme}
          onApi={(api) => (previewApi.current = api)}
          onSaveFile={onSaveFile}
          onSelectionChange={setSelectionCount}
          onRestore={openDialog}
          onCopy={copySelection}
          onBack={() => backToCurrent()}
          timeline={timeline}
          getCurrentElements={() =>
            (documentId
              ? getEditorApi(documentId)
              : undefined
            )?.getSceneElementsIncludingDeleted() ?? []
          }
          highlightChanges={highlightChanges}
        />
      )}
      {checkpointDelete.pending && (
        <ConfirmModal
          {...deleteCheckpointConfirm(versionLabel(checkpointDelete.pending))}
          onConfirm={() => void checkpointDelete.confirm()}
          onCancel={checkpointDelete.cancel}
        />
      )}
      {dialog && selected && (
        <RestoreDialog
          versionLabel={`${labelOf(selected)} (${formatTime(
            selected.createdAt,
          )})`}
          replaceRefusal={dialog.refusal}
          onReplace={() => void doReplace()}
          onCopy={() => void doCopy()}
          onCancel={() => setDialog(null)}
          drawingName={drawingName(path)}
        />
      )}
    </aside>
  );
};

export default HistoryPanel;
