/**
 * Tabs (F5): React glue. Builds the tabs runtime once per vault, restores and
 * saves the session, routes "open drawing" requests through the controller,
 * binds the tab commands and the native "close tab" event. With tabs disabled
 * no runtime exists and every entry point is a no-op, so the single-document
 * behaviour is untouched.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { stripDrawingExt } from "../vault/fileKind";

import { registerCommandHandlers } from "../commands/handlerRegistry";
import { TAB_COMMAND_IDS } from "../commands/tabCommands";
import { getEditorApi } from "../editor/editorApi";

import { estimateHistoryBytes } from "./historyBytes";
import { createMissingWatcher, probeExists } from "./missingWatcher";
import { pickRestoreView } from "./restoreView";
import { createStripSignals } from "./stripSignals";
import { buildTabHandlers } from "./tabHandlers";
import { createTabsRuntime } from "./tabController";
import { isKindPath } from "./tabKinds";
import { findByPath, getActiveTab } from "./tabsModel";
import { createWorkspaceStore, deserialize, serialize } from "./workspaceStore";

import type { UseVaultDocumentResult } from "../vault/useVaultDocument";
import type { VaultEntry, VaultInfo, VaultRepository } from "../vault/types";
import type { MountedDoc } from "./restoreView";
import type { ActiveTabGateProps } from "./ActiveTabGate";
import type { TabStripProps } from "./TabStrip";
import type { TabStore } from "./tabStore";
import type {
  NewTabPosition,
  OpenTarget,
  TabId,
  TabsState,
  ViewState,
} from "./types";
import type { TabsPreferences } from "./tabsSettings";

const MB = 1024 * 1024;

/** The tabs preference fields under the names the app uses. */
export type TabsSettings = Pick<
  TabsPreferences,
  | "tabsEnabled"
  | "tabsShowStrip"
  | "tabsOpenFromNavigator"
  | "tabsFocusNew"
  | "tabsNewTabPosition"
  | "tabsCtrlTab"
  | "tabsClosePinned"
  | "tabsRestore"
  | "tabsUndoBudgetMb"
>;

/** What a mounting editor needs for its document (VaultEditor `restore` prop). */
export type EditorRestore = {
  view?: ViewState;
  /** Consumes the undo snapshot (once); undefined when none matches. */
  takeUndo: () => unknown;
};

export interface UseTabsArgs {
  vault: VaultInfo | null;
  settings: TabsSettings;
  docHook: UseVaultDocumentResult;
  /** The app's busy-freeze + alert open; must reject on failure. */
  openDocument: (path: string) => Promise<void>;
  closeDocument: () => Promise<void>;
  notify: (message: string) => void;
  /** Runs a command by id (the app's dispatcher, honouring `when`). */
  runCommand: (id: string) => boolean;
  /** Closes the graph / gallery overlay when a tab is clicked under it. */
  closeOverlays: () => void;
  /** Whether the strip is on screen (a layout preset may hide or show it). */
  isStripShown?: () => boolean;
  /** Persists a preference (the strip toggle). */
  setShowStrip: (value: TabsSettings["tabsShowStrip"]) => void;
  /** Watcher events and existence probes for the missing-file marks. */
  repository: Pick<
    VaultRepository,
    "subscribe" | "readRevision" | "listDirectory"
  >;
  /** Show the navigator, expand to the path and focus its row. */
  revealInNavigator: (path: string) => void;
  /** Open the Cmd+P files palette; `newTab`: Enter opens in a new tab. */
  openPalette: (newTab: boolean) => void;
  /** Opens the search box with a query (the placeholder's "Search for it"). */
  searchFor: (query: string) => void;
  /** Index for pruning a restored session once the scan is done. */
  entries: readonly VaultEntry[];
  indexing: boolean;
}

export interface TabsApi {
  enabled: boolean;
  showStrip: boolean;
  store: TabStore | null;
  stripProps: Pick<
    TabStripProps,
    | "store"
    | "onActivate"
    | "onClose"
    | "onNewTab"
    | "onTogglePin"
    | "onMove"
    | "onCloseOthers"
    | "onCloseRight"
    | "onCloseAll"
    | "onCopyPath"
    | "onReveal"
    | "signals"
  > | null;
  /** Live reads for the links history (per tab) and open-tab checks. */
  getActiveId: () => string | null;
  openIds: () => ReadonlySet<string>;
  /** Props of <ActiveTabGate>: the placeholder for a missing active tab. */
  gateProps: Pick<
    ActiveTabGateProps,
    "store" | "onClose" | "onSearch" | "onOpenPath"
  > | null;
  /** Open a drawing per the opening rules; true when it is now shown (or opened in the background). */
  open: (path: string, target?: OpenTarget) => Promise<boolean>;
  /** Before creating a document: keep the outgoing tab's view and undo. */
  captureActive: () => void;
  /** After a document was created and opened. */
  openCreated: (path: string) => Promise<void>;
  renamed: (from: string, to: string) => void;
  removed: (path: string) => Promise<void>;
  /** The shown document was closed behind the tabs' back: reopen the active tab. */
  resync: () => void;
  /** Quit / vault switch: capture the view and write the session now. */
  prepareLeave: () => void;
  restoreFor: (
    path: string,
    revision: string,
    docId: string,
  ) => EditorRestore | undefined;
  /** A session restore is opening its active tab (a missing file is not an error then). */
  isRestoring: () => boolean;
}

const viewOf = (api: ExcalidrawImperativeAPI): ViewState => {
  const s = api.getAppState();
  return { scrollX: s.scrollX, scrollY: s.scrollY, zoom: s.zoom.value };
};

const closeWindow = () => {
  void import("@tauri-apps/api/window")
    .then(({ getCurrentWindow }) => getCurrentWindow().close())
    .catch(() => {
      // Not running inside Tauri.
    });
};

export function useTabs(args: UseTabsArgs): TabsApi {
  const { vault, settings } = args;
  const live = useRef(args);
  live.current = args;
  const workspace = useRef(createWorkspaceStore());
  const enabled = settings.tabsEnabled && vault !== null;
  const key = enabled ? vault.path : null;

  const runtime = useMemo(
    () =>
      key === null
        ? null
        : createTabsRuntime({
            undoBudgetBytes: live.current.settings.tabsUndoBudgetMb * MB,
            openDocument: (path) => live.current.openDocument(path),
            closeDocument: () => live.current.closeDocument(),
            isCustomKind: isKindPath,
            flushDocument: () => live.current.docHook.flush(),
            currentDocument: () => {
              const a = live.current.docHook.getActive();
              return a ? { path: a.path, revision: a.revision } : null;
            },
            captureEditor: () => {
              const id = live.current.docHook.getActive()?.id;
              const api = id ? getEditorApi(id) : undefined;
              if (!api) {
                return null;
              }
              return { view: viewOf(api), undo: api.history.export() };
            },
            estimateBytes: estimateHistoryBytes,
            // Switching away from a conflicted document is refused (as the
            // navigator did); the predicate says why, since the model is silent.
            isConflictBlocking: () => {
              if (live.current.docHook.status !== "conflict") {
                return false;
              }
              live.current.notify(
                "Resolve the save conflict before switching drawings",
              );
              return true;
            },
            // Open failures already show an alert in openDocument.
            onError: undefined,
            onPinnedCloseBlocked: () =>
              live.current.notify(
                "Pinned tab: unpin to close (or use Close from its menu)",
              ),
            closePinnedWithShortcut: () =>
              live.current.settings.tabsClosePinned,
            session: {
              save: (state: TabsState) => {
                const l = live.current;
                if (l.vault && !l.vault.readOnly && l.settings.tabsRestore) {
                  workspace.current.scheduleSave(key, state);
                }
              },
            },
          }),
    [key],
  );
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;
  const signals = useMemo(
    () => (runtime ? createStripSignals() : null),
    [runtime],
  );

  const copyPath = useCallback((path: string) => {
    void navigator.clipboard
      ?.writeText(path)
      .then(() => live.current.notify("Path copied"))
      .catch(() => {});
  }, []);

  // Flush a pending session write when the runtime goes away (vault switch,
  // tabs disabled, unmount).
  useEffect(
    () => () => {
      workspace.current.flush();
    },
    [runtime],
  );

  useEffect(() => {
    runtime?.memory.setBudget(settings.tabsUndoBudgetMb * MB);
  }, [runtime, settings.tabsUndoBudgetMb]);

  // Initial state: a document already open (tabs enabled mid-session) wins,
  // then the saved session, else the single home tab. A new vault handle for
  // the same path (retry writable) reopens the active tab.
  const initialised = useRef<{ runtime: unknown; handle: string } | null>(null);
  const restoring = useRef(false);
  const prune = useRef(false);
  useEffect(() => {
    if (!runtime || !vault) {
      return;
    }
    const seen = initialised.current;
    initialised.current = { runtime, handle: vault.handle };
    const { controller } = runtime;
    if (seen?.runtime !== runtime) {
      const current = live.current.docHook.getActive();
      if (current) {
        void controller.openCreated(current.path);
        return;
      }
      if (!live.current.settings.tabsRestore) {
        return;
      }
      const session = workspace.current.load(vault.path, () => true);
      if (session) {
        restoring.current = true;
        prune.current = true;
        void controller.restore(session).finally(() => {
          restoring.current = false;
        });
      }
    } else if (seen.handle !== vault.handle) {
      const session = deserialize(
        serialize(runtime.store.getState()),
        () => true,
      );
      void controller.restore(session);
    }
  }, [runtime, vault]);

  // A restored session may name files that are gone: drop them once the
  // vault scan has finished (the active file's failed open also marks it).
  useEffect(() => {
    if (
      !runtime ||
      !prune.current ||
      args.indexing ||
      args.entries.length === 0
    ) {
      return;
    }
    prune.current = false;
    const known = new Set(args.entries.map((e) => e.path));
    for (const tab of runtime.store.getState().tabs) {
      if (tab.path !== null && !known.has(tab.path)) {
        void runtime.controller.removed(tab.path);
      }
    }
  }, [runtime, args.indexing, args.entries]);

  const handle = vault?.handle;
  // Outside delete / move of a background tab's file marks it missing; the
  // file coming back clears the mark (see missingWatcher).
  useEffect(() => {
    if (!runtime || !handle) {
      return;
    }
    const { store, controller } = runtime;
    const watcher = createMissingWatcher({
      tabs: () => store.getState().tabs,
      activeId: () => store.getState().activeId,
      exists: (path) => probeExists(live.current.repository, handle, path),
      setMissing: (path, missing) => void controller.setMissing(path, missing),
    });
    let off: (() => void) | undefined;
    let disposed = false;
    live.current.repository
      .subscribe((event) => {
        if (event.handle === handle) {
          watcher.onChange(event.paths, event.rescan);
        }
      })
      .then((unsubscribe) => {
        if (disposed) {
          unsubscribe();
        } else {
          off = unsubscribe;
        }
      })
      .catch(() => {
        // The app's own watcher subscription reports a failing watcher.
      });
    return () => {
      disposed = true;
      watcher.dispose();
      off?.();
    };
  }, [runtime, handle]);

  // Command handlers (registered like the graph's).
  useEffect(() => {
    if (!runtime || !signals) {
      return;
    }
    return registerCommandHandlers(
      buildTabHandlers({
        controller: runtime.controller,
        store: runtime.store,
        ctrlTab: () => live.current.settings.tabsCtrlTab,
        newTabPosition: () => live.current.settings.tabsNewTabPosition,
        copyPath,
        signals,
        stripVisible: () =>
          live.current.isStripShown?.() ??
          live.current.settings.tabsShowStrip === "always",
        revealInNavigator: (path) => live.current.revealInNavigator(path),
        openPalette: (newTab) => live.current.openPalette(newTab),
        toggleStrip: () =>
          live.current.setShowStrip(
            live.current.settings.tabsShowStrip === "always"
              ? "never"
              : "always",
          ),
      }),
    );
  }, [runtime, signals, copyPath]);

  // Close window: closes through the save barrier (onCloseRequested).
  useEffect(
    () =>
      registerCommandHandlers({ [TAB_COMMAND_IDS.closeWindow]: closeWindow }),
    [],
  );

  // Native menu Cmd+W: close the tab; without tabs, the window as before.
  useEffect(() => {
    let off: (() => void) | undefined;
    let disposed = false;
    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen("vault-close-tab", () => {
          if (runtimeRef.current) {
            live.current.runCommand(TAB_COMMAND_IDS.close);
          } else {
            closeWindow();
          }
        }),
      )
      .then((unlisten) => {
        if (disposed) {
          unlisten();
        } else {
          off = unlisten;
        }
      })
      .catch(() => {
        // Not running inside Tauri.
      });
    return () => {
      disposed = true;
      off?.();
    };
  }, []);

  const open = useCallback(
    async (path: string, target?: OpenTarget): Promise<boolean> => {
      const rt = runtimeRef.current;
      const l = live.current;
      if (!rt) {
        return false;
      }
      const t: OpenTarget =
        target ??
        (l.settings.tabsOpenFromNavigator === "new" ? "new" : "current");
      await rt.controller.openPath(path, {
        target: t,
        focus: l.settings.tabsFocusNew,
        position: l.settings.tabsNewTabPosition as NewTabPosition,
      });
      return (
        l.docHook.getActive()?.path === path ||
        (isKindPath(path) && getActiveTab(rt.store.getState()).path === path) ||
        (t === "new" && !!findByPath(rt.store.getState(), path))
      );
    },
    [],
  );

  const stripProps = useMemo(() => {
    if (!runtime || !signals) {
      return null;
    }
    const { controller, store } = runtime;
    const pathOf = (id: TabId) =>
      store.getState().tabs.find((t) => t.id === id)?.path ?? null;
    const withPath = (run: (path: string) => void) => (id: TabId) => {
      const path = pathOf(id);
      if (path) {
        run(path);
      }
    };
    return {
      store,
      signals,
      onTogglePin: (id: TabId) => void controller.togglePin(id),
      onMove: (id: TabId, toIndex: number) => void controller.move(id, toIndex),
      onCloseOthers: (id: TabId) => void controller.closeOthers(id),
      onCloseRight: (id: TabId) => void controller.closeRight(id),
      onCloseAll: () => void controller.closeAll(),
      onCopyPath: withPath(copyPath),
      onReveal: withPath((path) => live.current.revealInNavigator(path)),
      onActivate: (id: TabId) => {
        live.current.closeOverlays();
        void controller.activate(id);
      },
      onClose: (id: TabId) => void controller.close(id),
      onNewTab: () => {
        live.current.closeOverlays();
        void controller.newTab(live.current.settings.tabsNewTabPosition);
      },
    };
  }, [runtime, signals, copyPath]);

  const gateProps = useMemo(() => {
    if (!runtime) {
      return null;
    }
    const { controller, store } = runtime;
    return {
      store,
      onClose: () => void controller.close(getActiveTab(store.getState()).id),
      onOpenPath: (path: string, opts?: { target?: OpenTarget }) => {
        void open(path, opts?.target);
      },
      onSearch: (path: string) =>
        live.current.searchFor(stripDrawingExt(path.split("/").pop() ?? path)),
    };
  }, [runtime, open]);

  // The editor mounted before the current one (see restoreFor).
  const mountedDoc = useRef<MountedDoc | null>(null);
  const restoreCache = useRef<{ docId: string; value: EditorRestore } | null>(
    null,
  );
  const restoreFor = useCallback(
    (
      path: string,
      revision: string,
      docId: string,
    ): EditorRestore | undefined => {
      const controller = runtime?.controller;
      if (!controller) {
        return undefined;
      }
      // Render may run twice for one document: the first answer stands.
      if (restoreCache.current?.docId === docId) {
        return restoreCache.current.value;
      }
      const value: EditorRestore = {
        view: pickRestoreView({
          prev: mountedDoc.current,
          docId,
          path,
          readLive: (id) => {
            const api = getEditorApi(id);
            return api ? viewOf(api) : null;
          },
          stored: controller.pendingRestore(path).view,
        }),
        takeUndo: () => controller.takeRestore(path, revision).undo,
      };
      mountedDoc.current = { id: docId, path };
      restoreCache.current = { docId, value };
      return value;
    },
    [runtime],
  );

  return {
    enabled: runtime !== null,
    showStrip: runtime !== null && settings.tabsShowStrip === "always",
    store: runtime?.store ?? null,
    stripProps,
    gateProps,
    getActiveId: useCallback(
      () => runtimeRef.current?.store.getState().activeId ?? null,
      [],
    ),
    openIds: useCallback(
      () => new Set(runtimeRef.current?.store.getState().tabs.map((t) => t.id)),
      [],
    ),
    open,
    captureActive: useCallback(
      () => runtimeRef.current?.controller.captureActive(),
      [],
    ),
    openCreated: useCallback(
      (path: string) =>
        runtimeRef.current?.controller.openCreated(path) ?? Promise.resolve(),
      [],
    ),
    renamed: useCallback(
      (from: string, to: string) =>
        runtimeRef.current?.controller.renamed(from, to),
      [],
    ),
    removed: useCallback(
      (path: string) =>
        runtimeRef.current?.controller.removed(path) ?? Promise.resolve(),
      [],
    ),
    resync: useCallback(() => {
      const rt = runtimeRef.current;
      if (rt) {
        void rt.controller.restore(
          deserialize(serialize(rt.store.getState()), () => true),
        );
      }
    }, []),
    prepareLeave: useCallback(() => {
      runtimeRef.current?.controller.captureActive();
      workspace.current.flush();
    }, []),
    restoreFor,
    isRestoring: useCallback(() => restoring.current, []),
  };
}
