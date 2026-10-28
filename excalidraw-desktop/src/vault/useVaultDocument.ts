import { useCallback, useEffect, useRef, useState } from "react";

import { serializeAsJSON } from "@excalidraw/excalidraw";

import { appEvents } from "../events/appEvents";
import { markOpen } from "../perf/openMarks";

import { flushEditorSerialization } from "../editor/editorFlush";
import { createOutsideFallback } from "../history/outsideFallback";

import { takeSpeculativeRead } from "../speculative/speculativeOpen";

import {
  errorMessage,
  type SaveStatus,
  type VaultInfo,
  type VaultRepository,
} from "./types";
import { isWritableDrawing } from "./fileKind";
import { SaveCoordinator } from "./saveCoordinator";

import type { HistoryRepository } from "../history/types";

/**
 * Mutable, per-activation handle to the document text. The editor reads it
 * only when it loads the scene; after each save it points at the saved string
 * (the same reference the save path holds), so no load-time copy stays alive
 * and no re-render is needed.
 */
export type DocumentSource = { json: string };

export type VaultDocument = {
  id: string;
  path: string;
  source: DocumentSource;
  revision: string;
};
export type UseVaultDocumentResult = {
  document: VaultDocument | null;
  /** The live document right now (path and the latest saved revision, id of the mounted editor); `document` lags a render and keeps the load revision. */
  getActive: () => { id: string; path: string; revision: string } | null;
  /** The open drawing's file is read-only (view mode and a banner); lifts when it becomes writable. */
  fileReadOnly: boolean;
  status: SaveStatus;
  error: string | null;
  loading: boolean;
  open: (path: string) => Promise<void>;
  create: (
    parent: string,
    name: string,
    initialAppState?: Record<string, unknown>,
    /** Full scene JSON to start from (templates); wins over `initialAppState`. */
    initialJson?: string,
  ) => Promise<void>;
  change: (json: string) => void;
  /** Persist pending edits. `commitText` (default true) also ends text editing. */
  flush: (options?: { commitText?: boolean }) => Promise<void>;
  close: () => Promise<void>;
  reload: () => Promise<void>;
  saveCopy: (path: string) => Promise<void>;
  /** `move` replaces the plain repository move (a links-aware move). */
  relocate: (
    from: string,
    to: string,
    move?: (from: string, to: string) => Promise<unknown>,
  ) => Promise<void>;
};

type Active = Omit<VaultDocument, "source"> & {
  source: DocumentSource;
  handle: string;
  currentJson: string;
  savedJson: string;
  deleted: boolean;
  /** The file has no write permission: the editor shows it in view mode and nothing is saved. */
  readOnly: boolean;
};
const withoutSource = ({
  source: _source,
  ...rest
}: Active): Omit<Active, "source"> => rest;
/**
 * A replaced activation's document text. React keeps the previous render's props (and
 * so its closures, which capture the whole old document) in the old fiber until a later
 * render, so an old drawing's text stayed in memory after a switch. Emptying it here
 * keeps whatever still points at the old activation at a few bytes.
 */
const releaseActive = (old: Active | null) => {
  if (!old) {
    return;
  }
  old.source.json = "";
  old.currentJson = "";
  old.savedJson = "";
};
const operationId = () =>
  `vault-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const isNotFound = (error: unknown) =>
  /not.?found|deleted/i.test(errorMessage(error));

export const useVaultDocument = (
  repository: VaultRepository,
  vault: VaultInfo | null,
  options?: {
    autosaveDelayMs?: number;
    history?: HistoryRepository;
    /** A save produced `revision` for `path` (thumbnail staleness). */
    onDrawingSaved?: (path: string, revision: string) => void;
  },
): UseVaultDocumentResult => {
  const [document, setDocument] = useState<VaultDocument | null>(null);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fileReadOnly, setFileReadOnly] = useState(false);
  const active = useRef<Active | null>(null);
  const coordinator = useRef<SaveCoordinator | null>(null);
  const generation = useRef(0);
  const statusRef = useRef<SaveStatus>("saved");
  const errorRef = useRef<string | null>(null);
  const vaultRef = useRef(vault);
  const observedVaultHandle = useRef(vault?.handle);
  const repositoryRef = useRef(repository);
  const autosaveDelayMsRef = useRef(options?.autosaveDelayMs);
  autosaveDelayMsRef.current = options?.autosaveDelayMs;
  const historyRef = useRef(options?.history);
  historyRef.current = options?.history;
  const onDrawingSavedRef = useRef(options?.onDrawingSaved);
  onDrawingSavedRef.current = options?.onDrawingSaved;
  const [fallback] = useState(() =>
    createOutsideFallback(() => historyRef.current),
  );
  const setCurrentStatus = useCallback(
    (next: SaveStatus, message?: string | null) => {
      statusRef.current = next;
      setStatus(next);
      if (message !== undefined) {
        errorRef.current = message;
        setError(message);
      }
    },
    [],
  );
  vaultRef.current = vault;
  repositoryRef.current = repository;

  const flush = useCallback(
    async ({ commitText = true }: { commitText?: boolean } = {}) => {
      const current = active.current;
      if (current) {
        flushEditorSerialization(current.id, { commitText });
      }
      if (statusRef.current === "conflict") {
        throw new Error(
          errorRef.current ?? "Resolve the save conflict before continuing",
        );
      }
      try {
        await coordinator.current?.flush();
      } catch (cause) {
        const message = errorMessage(cause);
        errorRef.current = message;
        setError(message);
        throw cause;
      }
    },
    [],
  );

  // A move in flight: change events for it must wait until the active
  // document's path is updated, or they read the old path and see NOT_FOUND.
  const relocation = useRef<Promise<unknown> | null>(null);

  const activate = useCallback(
    async (fresh: Omit<Active, "source"> | null) => {
      const activationGeneration = generation.current;
      const previousCoordinator = coordinator.current;
      coordinator.current = null;
      await previousCoordinator?.stop(new Error("Document changed"));
      if (activationGeneration !== generation.current) {
        return;
      }
      // Every activation gets its own handle (reload, open, copy...).
      const next: Active | null = fresh
        ? { ...fresh, source: { json: fresh.savedJson } }
        : null;
      const replaced = active.current;
      active.current = next;
      if (next) {
        appEvents.emit("drawing.opened", { path: next.path });
      }
      setDocument(
        next
          ? {
              id: next.id,
              path: next.path,
              source: next.source,
              revision: next.revision,
            }
          : null,
      );
      releaseActive(replaced === next ? null : replaced);
      setFileReadOnly(next?.readOnly ?? false);
      setCurrentStatus("saved", null);
      if (!next) {
        return;
      }
      const coordinatorForDocument = new SaveCoordinator({
        repository,
        hold: () => relocation.current,
        idleMs: autosaveDelayMsRef.current,
        target: () => {
          const current = active.current;
          return current &&
            !current.deleted &&
            !current.readOnly &&
            !vaultRef.current?.readOnly &&
            isWritableDrawing(current.path)
            ? {
                handle: current.handle,
                path: current.path,
                documentId: current.id,
                revision: current.revision,
              }
            : null;
        },
        snapshot: () => active.current?.currentJson ?? null,
        onStatus: (nextStatus, cause) => {
          if (active.current !== next) {
            return;
          }
          setCurrentStatus(
            nextStatus,
            cause
              ? errorMessage(cause)
              : nextStatus === "saved"
              ? null
              : undefined,
          );
          if (nextStatus === "conflict") {
            void coordinatorForDocument.stop(cause);
          }
        },
        onSaved: (revision, json) => {
          if (active.current !== next) {
            return;
          }
          next.revision = revision;
          next.savedJson = json;
          onDrawingSavedRef.current?.(next.path, revision);
          appEvents.emit("drawing.saved", { path: next.path });
          next.source.json = json;
          if (next.currentJson === json) {
            setCurrentStatus("saved", null);
          }
        },
      });
      coordinator.current = coordinatorForDocument;
    },
    [repository, setCurrentStatus],
  );

  const open = useCallback(
    async (path: string) => {
      const currentVault = vaultRef.current;
      if (!currentVault) {
        throw new Error("Choose a vault first");
      }
      const mine = ++generation.current;
      if (active.current) {
        await flush();
      }
      if (
        mine !== generation.current ||
        vaultRef.current?.handle !== currentVault.handle
      ) {
        return;
      }
      setLoading(true);
      try {
        markOpen("read");
        // started on pointer-down when speculative open is on (speculative/)
        const ahead = takeSpeculativeRead(currentVault.handle, path);
        const loaded =
          (ahead && (await ahead.catch(() => null))) ||
          (await repositoryRef.current.readDrawing(currentVault.handle, path));
        markOpen("read-done");
        if (
          mine !== generation.current ||
          vaultRef.current?.handle !== currentVault.handle
        ) {
          return;
        }
        // The canvas remains editable while IO is pending. Persist any edits made
        // since the initial barrier before replacing its editor instance.
        if (active.current) {
          await flush();
        }
        if (
          mine !== generation.current ||
          vaultRef.current?.handle !== currentVault.handle
        ) {
          return;
        }
        markOpen("activate");
        await activate({
          id: `${currentVault.handle}:${mine}:${path}`,
          path,
          currentJson: loaded.json,
          savedJson: loaded.json,
          revision: loaded.revision,
          handle: currentVault.handle,
          deleted: false,
          readOnly: loaded.readOnly === true,
        });
      } catch (cause) {
        if (mine === generation.current) {
          errorRef.current = errorMessage(cause);
          setError(errorRef.current);
        }
        throw cause;
      } finally {
        if (mine === generation.current) {
          setLoading(false);
        }
      }
    },
    [activate, flush],
  );

  const create = useCallback(
    async (
      parent: string,
      name: string,
      initialAppState?: Record<string, unknown>,
      initialJson?: string,
    ) => {
      const currentVault = vaultRef.current;
      if (!currentVault) {
        throw new Error("Choose a vault first");
      }
      if (currentVault.readOnly) {
        throw new Error("This vault is read-only");
      }
      const mine = ++generation.current;
      if (active.current) {
        await flush();
      }
      if (
        mine !== generation.current ||
        vaultRef.current?.handle !== currentVault.handle
      ) {
        return;
      }
      const path = parent ? `${parent}/${name}` : name;
      const initial =
        initialJson ?? serializeAsJSON([], initialAppState ?? {}, {}, "local");
      const created = await repositoryRef.current.writeDrawing({
        handle: currentVault.handle,
        path,
        json: initial,
        expectedRevision: null,
        operationId: operationId(),
      });
      if (
        mine !== generation.current ||
        vaultRef.current?.handle !== currentVault.handle
      ) {
        return;
      }
      if (active.current) {
        await flush();
      }
      if (
        mine !== generation.current ||
        vaultRef.current?.handle !== currentVault.handle
      ) {
        return;
      }
      await activate({
        id: `${currentVault.handle}:${mine}:${path}`,
        path,
        currentJson: initial,
        savedJson: initial,
        revision: created.revision,
        handle: currentVault.handle,
        deleted: false,
        readOnly: false,
      });
    },
    [activate, flush],
  );

  const change = useCallback(
    (json: string) => {
      const current = active.current;
      if (
        !current ||
        vaultRef.current?.readOnly ||
        !isWritableDrawing(current.path) ||
        current.currentJson === json
      ) {
        return;
      }
      current.currentJson = json;
      // A conflict is a barrier, not a transient save state. Keep accepting edits
      // so Save Copy can serialize the latest scene, including after deletion.
      if (statusRef.current === "conflict" || current.deleted) {
        return;
      }
      setCurrentStatus("dirty", null);
      coordinator.current?.schedule();
    },
    [setCurrentStatus],
  );

  const close = useCallback(async () => {
    const mine = generation.current;
    await flush();
    if (mine !== generation.current) {
      return;
    }
    ++generation.current;
    await activate(null);
  }, [activate, flush]);

  const reload = useCallback(async () => {
    const current = active.current;
    const currentVault = vaultRef.current;
    if (!currentVault || !current) {
      return;
    }
    const mine = ++generation.current;
    flushEditorSerialization(current.id, { commitText: true });
    // Keep the existing coordinator attached until the read succeeds. A failed
    // reload must leave the current document and its save path usable.
    let loaded = await repositoryRef.current.readDrawing(
      current.handle,
      current.path,
    );
    if (
      mine !== generation.current ||
      vaultRef.current?.handle !== currentVault.handle ||
      active.current !== current
    ) {
      return;
    }
    // A scheduled write may have settled after the first read. Stop only after
    // successful IO, then reread the settled disk state before replacing edits.
    const oldCoordinator = coordinator.current;
    await oldCoordinator?.stop(new Error("Reloading document"));
    coordinator.current = null;
    try {
      loaded = await repositoryRef.current.readDrawing(
        current.handle,
        current.path,
      );
    } catch (cause) {
      setCurrentStatus(
        "conflict",
        `Reload failed after stopping saves: ${errorMessage(
          cause,
        )}. Save a copy to keep your edits.`,
      );
      throw cause;
    }
    if (
      mine !== generation.current ||
      vaultRef.current?.handle !== currentVault.handle ||
      active.current !== current
    ) {
      return;
    }
    if (current.currentJson !== current.savedJson) {
      await fallback.beforeDiscard(
        current.handle,
        current.path,
        current.currentJson,
      );
    }
    await activate({
      ...withoutSource(current),
      id: `${current.handle}:${mine}:${current.path}`,
      currentJson: loaded.json,
      savedJson: loaded.json,
      revision: loaded.revision,
      deleted: false,
      readOnly: loaded.readOnly === true,
    });
  }, [activate, fallback, setCurrentStatus]);

  const saveCopy = useCallback(
    async (path: string) => {
      const current = active.current;
      const currentVault = vaultRef.current;
      if (!current || !currentVault) {
        throw new Error("No active drawing");
      }
      const mine = ++generation.current;
      flushEditorSerialization(current.id);
      const json = current.currentJson;
      if (currentVault.readOnly) {
        throw new Error("This vault is read-only");
      }
      // Do not detach the active save path until the create-only write succeeds;
      // collisions and IO failures must leave the current scene fully saveable.
      if (
        mine !== generation.current ||
        vaultRef.current?.handle !== currentVault.handle ||
        active.current !== current
      ) {
        return;
      }
      let saved = await repositoryRef.current.writeDrawing({
        handle: current.handle,
        path,
        json,
        expectedRevision: null,
        operationId: operationId(),
      });
      if (
        mine !== generation.current ||
        vaultRef.current?.handle !== currentVault.handle ||
        active.current !== current
      ) {
        return;
      }
      // Include edits made while the create-only write was pending. Use revision
      // checks for subsequent updates so a concurrent destination edit is never overwritten.
      let copyJson = json;
      while (current.currentJson !== copyJson) {
        copyJson = current.currentJson;
        saved = await repositoryRef.current.writeDrawing({
          handle: current.handle,
          path,
          json: copyJson,
          expectedRevision: saved.revision,
          operationId: operationId(),
        });
        if (
          mine !== generation.current ||
          vaultRef.current?.handle !== currentVault.handle ||
          active.current !== current
        ) {
          return;
        }
      }
      await activate({
        ...current,
        id: `${current.handle}:${mine}:${path}`,
        path,
        currentJson: copyJson,
        savedJson: copyJson,
        revision: saved.revision,
        deleted: false,
        readOnly: false,
      });
    },
    [activate],
  );

  const relocate = useCallback(
    async (
      from: string,
      to: string,
      move?: (from: string, to: string) => Promise<unknown>,
    ) => {
      const current = active.current;
      const currentVault = vaultRef.current;
      if (!currentVault) {
        return;
      }
      if (currentVault.readOnly) {
        throw new Error("This vault is read-only");
      }
      const mine = generation.current;
      if (current) {
        await flush();
      }
      if (
        mine !== generation.current ||
        vaultRef.current?.handle !== currentVault.handle
      ) {
        return;
      }
      // Set before calling move: a repository may emit its change event
      // synchronously from inside move().
      let settle = () => {};
      const pending = new Promise<void>((resolve) => {
        settle = resolve;
      });
      relocation.current = pending;
      try {
        await (
          move ??
          ((f, t) => repositoryRef.current.move(currentVault.handle, f, t))
        )(from, to);
      } finally {
        settle();
        // The path update below is synchronous, so a waiting event handler
        // resumes only after it.
        if (relocation.current === pending) {
          relocation.current = null;
        }
      }
      if (
        mine !== generation.current ||
        vaultRef.current?.handle !== currentVault.handle ||
        !current ||
        active.current !== current
      ) {
        return;
      }
      const path =
        current.path === from
          ? to
          : current.path.startsWith(`${from}/`)
          ? `${to}${current.path.slice(from.length)}`
          : current.path;
      if (path !== current.path) {
        current.path = path;
        setDocument({
          id: current.id,
          path,
          source: current.source,
          revision: current.revision,
        });
      }
    },
    [flush],
  );

  useEffect(() => {
    if (!vault) {
      return;
    }
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void repository
      .subscribe((event) => {
        const current = active.current;
        if (!current || disposed || event.handle !== current.handle) {
          return;
        }
        const relevant =
          event.rescan ||
          event.paths.some(
            (path) =>
              path === current.path || current.path.startsWith(`${path}/`),
          );
        if (!relevant) {
          return;
        }
        flushEditorSerialization(current.id);
        const checkGeneration = generation.current;
        void (async () => {
          // Do not drop watcher events during writes: wait for the acknowledgement
          // to advance the revision, then compare against the settled disk state.
          if (relocation.current) {
            await relocation.current;
          }
          if (coordinator.current?.isWriting) {
            try {
              await coordinator.current.flush();
            } catch {
              /* surfaced by save status */
            }
          }
          if (
            disposed ||
            checkGeneration !== generation.current ||
            active.current !== current
          ) {
            return;
          }
          if (current.readOnly && repository.readOnlyState) {
            // A permission change leaves the content alone, so this check comes before the
            // revision comparison: the file became writable, lift view mode and the banner.
            const stillReadOnly = await repository
              .readOnlyState(current.handle, current.path)
              .catch(() => true);
            if (
              disposed ||
              checkGeneration !== generation.current ||
              active.current !== current
            ) {
              return;
            }
            if (!stillReadOnly) {
              current.readOnly = false;
              setFileReadOnly(false);
            }
          }
          if (repository.readRevision) {
            // Our own saves echo through the watcher: compare revisions first and
            // skip the full read when nothing changed. A missing file is deleted.
            const diskRevision = await repository.readRevision(
              current.handle,
              current.path,
            );
            if (diskRevision === null) {
              throw new Error("Drawing not found");
            }
            if (
              disposed ||
              checkGeneration !== generation.current ||
              active.current !== current ||
              diskRevision === current.revision
            ) {
              return;
            }
          }
          const disk = await repository.readDrawing(
            current.handle,
            current.path,
          );
          if (
            disposed ||
            checkGeneration !== generation.current ||
            active.current !== current ||
            disk.revision === current.revision
          ) {
            return;
          }
          if (disk.json === current.currentJson) {
            current.revision = disk.revision;
            // Equal text: keep one reference instead of two copies.
            current.currentJson = disk.json;
            current.savedJson = disk.json;
            current.source.json = disk.json;
            setCurrentStatus("saved", null);
            return;
          }
          fallback.beforeOutsideChange(
            current.handle,
            current.path,
            current.revision,
            current.savedJson,
          );
          if (current.currentJson !== current.savedJson) {
            setCurrentStatus(
              "conflict",
              "This drawing changed outside the editor. Save a copy or reload the disk version.",
            );
            await coordinator.current?.stop(
              new Error("External change conflict"),
            );
          } else {
            const nextGeneration = ++generation.current;
            await activate({
              ...withoutSource(current),
              id: `${current.handle}:${nextGeneration}:${current.path}`,
              currentJson: disk.json,
              savedJson: disk.json,
              revision: disk.revision,
              readOnly: disk.readOnly === true,
            });
          }
        })().catch(async (cause) => {
          if (
            disposed ||
            checkGeneration !== generation.current ||
            active.current !== current
          ) {
            return;
          }
          if (isNotFound(cause)) {
            current.deleted = true;
            await coordinator.current?.stop(
              new Error(
                "The active drawing was deleted; saving to its old path is disabled.",
              ),
            );
            setCurrentStatus(
              "conflict",
              "The active drawing was deleted outside the editor. Save a copy to keep your changes.",
            );
          } else {
            setCurrentStatus("error", errorMessage(cause));
          }
        });
      })
      .then((off) => {
        if (disposed) {
          off();
        } else {
          unsubscribe = off;
        }
      })
      .catch((cause) => {
        if (!disposed) {
          setCurrentStatus("error", errorMessage(cause));
        }
      });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
    // `vault` is only null-checked; resubscribe on handle change, not on every new VaultInfo object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activate, fallback, repository, vault?.handle, setCurrentStatus]);

  useEffect(() => {
    const previous = observedVaultHandle.current;
    const next = vault?.handle;
    observedVaultHandle.current = next;
    if (previous !== next) {
      const mine = ++generation.current;
      const oldCoordinator = coordinator.current;
      coordinator.current = null;
      void (async () => {
        await oldCoordinator?.stop(new Error("Vault changed"));
        if (mine !== generation.current) {
          return;
        }
        releaseActive(active.current);
        active.current = null;
        setDocument(null);
        setCurrentStatus("saved", null);
      })();
    }
  }, [vault?.handle, setCurrentStatus]);

  useEffect(
    () => () => {
      void coordinator.current?.stop();
    },
    [],
  );

  const getActive = useCallback(() => {
    const a = active.current;
    return a ? { id: a.id, path: a.path, revision: a.revision } : null;
  }, []);

  return {
    document,
    getActive,
    fileReadOnly,
    status,
    error,
    loading,
    open,
    create,
    change,
    flush,
    close,
    reload,
    saveCopy,
    relocate,
  };
};
