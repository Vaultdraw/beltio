import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { errorMessage, isNotFoundError } from "./vault/types";
import {
  desktopRepository,
  isTauriAvailable,
} from "./vault/DesktopVaultRepository";
import { DesktopVaultSearch } from "./search/DesktopVaultSearch";
import { DesktopVaultLinks } from "./links/DesktopVaultLinks";
import { useLinkDisplayPrefs } from "./links/useLinkDisplayPrefs";
import { resolveOpenTarget } from "./control/openTarget";
import { createAppFiles } from "./control/appFiles";
import { openVaultAtPath } from "./control/vaultOpen";
import { useControlBridge } from "./control/useControlBridge";
import { useAppLinks } from "./links/useAppLinks";
import { DesktopVaultTagRename } from "./tags/DesktopVaultTagRename";
import { useAppTags } from "./tags/useAppTags";
import { usePalettePick } from "./palette/usePalettePick";
import {
  addRecentVault,
  getExpandedFolders,
  getLinksSettings,
  getPdfImportSettings,
  getTagsSettings,
  getLastVaultPath,
  getNavigatorCollapsed,
  getPreferences,
  getRecentVaults,
  getTheme,
  removeRecentVault,
  setExpandedFolders as saveExpandedFolders,
  setNavigatorCollapsed as saveNavigatorCollapsed,
  setTheme,
  updatePreferences,
} from "./vault/preferences";
import { getDefaultBackgroundPattern } from "./vault/paperDefaults";
import { getNewDrawingPageSetup } from "./vault/pageDefaults";
import { getPageSetupPatch } from "./page/pageSetupChange";
import { isPageCommandChecked } from "./page/pageStatus";
import {
  getSettingsStatus,
  PREFERENCES_CHANGED_EVENT,
  SETTINGS_STATUS_EVENT,
  type SettingsStatus,
} from "./vault/settingsSync";
import {
  buildTree,
  createProgressThrottle,
  duplicateName,
  getBaseName,
  getParentPath,
  joinPath,
  rebaseFolderPath,
  scanVaultMetadata,
} from "./vault/treeStore";
import { useVaultDocument } from "./vault/useVaultDocument";
import { useAppearance } from "./vault/useAppearance";
import { runZoomCommand, useInterfaceZoom } from "./vault/useInterfaceZoom";
import { useVaultSettings } from "./vault/useVaultSettings";
import { tagQuery } from "./tags/types";
import { useTemplates } from "./templates/useTemplates";
import { isInTemplatesFolder } from "./templates/listTemplates";
import {
  ensureFolder,
  folderChain,
  resolveNewDrawingParent,
} from "./vault/newDrawing";
import { commitCanvasTextEdit } from "./commands/context";
import { ActivityBar } from "./activityBar/ActivityBar";
import { galleryPanelStore, graphPanelStore } from "./activityBar/panelStores";
import { getRegisteredHandler } from "./commands/handlerRegistry";
import { GRAPH_COMMAND_IDS } from "./commands/graphCommands";
import { THUMBNAIL_COMMAND_IDS } from "./commands/thumbnailCommands";
import { TabStrip } from "./tabs/TabStrip";
import { ActiveTabGate } from "./tabs/ActiveTabGate";
import "./tabs/editorBody.css";
import { ancestorFolders } from "./tabs/revealPath";
import { useTabs } from "./tabs/useTabs";
import { appCommandHandlers } from "./commands/useAppCommands";
import {
  useCommandDispatcher,
  type CommandRunner,
} from "./commands/useCommands";
import { drawingOpenCommandId } from "./commands/drawingCommands";
import { useCommandShortcutLookup } from "./commands/useCommandShortcut";
import {
  collectPaletteItems,
  registerPaletteProvider,
} from "./palette/registry";
import { focusCanvasIfIdle } from "./palette/focus";
import { createCommandsProvider } from "./palette/providers/commands";
import { createThemesProvider } from "./palette/providers/themes";
import { resolveSelectedTheme } from "./theme/registry";
import { GraphHost, type GraphHostProps } from "./graph/GraphHost";
import { GalleryHost } from "./thumbnails/gallery/GalleryHost";
import { useGraphEntry } from "./graph/useGraphEntry";
import { createDesktopThumbnailStore } from "./thumbnails/desktopStore";
import { ThumbnailsRoot } from "./thumbnails/ThumbnailsRoot";
import { HistoryHost } from "./history/HistoryHost";
import { PluginPanels } from "./plugins/host/PluginPanels";
import { setPluginCommandRunner } from "./plugins/host/runner";
import { useHistoryEntry } from "./history/useHistoryEntry";
import { desktopHistoryRepository } from "./history/DesktopHistoryRepository";
import { toHistorySettings } from "./history/historySettings";
import { LibraryStore } from "./library/libraryStore";
import { desktopLibraryRepository } from "./library/DesktopLibraryRepository";
import VaultEditor from "./editor/VaultEditor";
import { getEditorApi } from "./editor/editorApi";
import { desktopPdfBridge } from "./pdfImport/DesktopPdfBridge";
import { usePdfImport } from "./pdfImport/usePdfImport";
import { useCanvasImport } from "./canvasImport/useCanvasImport";

import { VaultHeader } from "./components/VaultHeader";
import {
  VaultNavigator,
  type NavigatorAction,
  type NavigatorRequest,
} from "./components/VaultNavigator";
import { useExplorerExport } from "./export/useExplorerExport";
import { Onboarding } from "./components/Onboarding";
import { ConflictDialog } from "./components/ConflictDialog";
import { RecoveryDialog } from "./components/RecoveryDialog";

import { QuickSwitcher } from "./components/QuickSwitcher";
import { Banner } from "./components/Banner";
import { Toasts } from "./components/Toasts";
import { toastStore } from "./toasts/toastStore";
import { describeReadOnly } from "./vault/readOnlyReason";
import { ConfirmModal } from "./components/ConfirmModal";
import { VaultHome } from "./components/VaultHome";

import "./components/VaultShell.css";
import "./components/shell.css";

import type { OpenTarget } from "./tabs/types";
import type { TabsApi } from "./tabs/useTabs";
import type { PdfBridge } from "./pdfImport/types";
import type { SettingsTarget } from "./components/settings/schema";
import type { PaletteMode } from "./palette/rank";
import type { PaletteItem } from "./palette/types";
import type { SortOrder } from "./vault/sortOrder";
import type { VaultSearch } from "./search/types";
import type { ThumbnailService } from "./thumbnails/service";
import type { ThumbnailStore } from "./thumbnails/store";
import type { VaultLinks } from "./links/types";
import type { VaultTagRename } from "./tags/types";

import type { LibraryRepository } from "./library/types";
import type { HistoryRepository } from "./history/types";
import type {
  VaultChange,
  VaultEntry,
  VaultInfo,
  VaultRepository,
} from "./vault/types";

// The dock loads on demand: nothing about links is in the startup bundle.
const LinksDock = lazy(() =>
  import("./components/links/LinksDock").then((m) => ({
    default: m.LinksDock,
  })),
);

// Settings (every page, the Links and Hotkeys editors) stay out of the
// startup chunk; prefetchSettings loads them once the vault is idle, so the
// first Cmd+, still opens in the same frame. A prefetched module renders
// directly: lazy() always suspends once, and React holds a shown fallback
// for 300 ms.
type SettingsModalModule = typeof import("./components/settings/SettingsModal");
let settingsModule: SettingsModalModule | null = null;
const loadSettingsModal = () =>
  import("./components/settings/SettingsModal").then((m) => {
    settingsModule = m;
    return m;
  });
const LazySettingsModal = lazy(() =>
  loadSettingsModal().then((m) => ({ default: m.SettingsModal })),
);
const prefetchSettings = () => {
  const ric = (
    globalThis as {
      requestIdleCallback?: (cb: () => void, o: { timeout: number }) => number;
    }
  ).requestIdleCallback;
  const run = () => void loadSettingsModal().catch(() => {});
  if (ric) {
    ric(run, { timeout: 3000 });
  } else {
    setTimeout(run, 1500);
  }
};

export interface VaultAppProps {
  ownerDocument?: Document | null;
  ownerWindow?: Window | null;
  repository?: VaultRepository;
  /** Vault-wide search; defaults to the native index under Tauri, else name-only. */
  search?: VaultSearch | null;
  /** Link index; defaults to the native one under Tauri, else none. */
  links?: VaultLinks | null;
  /** Tag rename client; defaults to the native one under Tauri, else none. */
  tagRename?: VaultTagRename | null;
  initialVault?: VaultInfo | null;
  libraryRepository?: LibraryRepository;
  /** File history; defaults to the native service. */
  history?: HistoryRepository;
  /** Tests / e2e: graph source and settings transport instead of the native ones. */
  graph?: Pick<GraphHostProps, "graphSource" | "invoke" | "onSession">;
  /** PDF import (native renderer); defaults to the desktop bridge. */
  pdf?: PdfBridge;
  /** Thumbnail cache; defaults to the native one under Tauri, else none (text UI). */
  thumbnails?: ThumbnailStore | null;
}

export const VaultApp = ({
  ownerDocument: propDoc,
  ownerWindow: propWin,
  repository = desktopRepository,
  search,
  links,
  tagRename,
  initialVault = null,
  libraryRepository = desktopLibraryRepository,
  history = desktopHistoryRepository,
  graph,
  pdf = desktopPdfBridge,
  thumbnails,
}: VaultAppProps) => {
  const libraryBundle = useMemo(
    () => ({
      store: new LibraryStore(libraryRepository),
      repository: libraryRepository,
    }),
    [libraryRepository],
  );
  const libraryStore = libraryBundle.store;
  const [mountedDocument, setMountedDocument] = useState<Document | null>(null);

  // Derive browser APIs from the mounted node, never from ambient globals.
  const doc = propDoc ?? mountedDocument;
  const win = propWin ?? doc?.defaultView ?? null;
  const defaultSearch = useMemo(
    () => (isTauriAvailable(win) ? new DesktopVaultSearch() : null),
    [win],
  );
  const vaultSearch = search === undefined ? defaultSearch : search;
  const defaultLinks = useMemo(
    () => (isTauriAvailable(win) ? new DesktopVaultLinks() : null),
    [win],
  );
  const vaultLinks = links === undefined ? defaultLinks : links;
  const defaultTagRename = useMemo(
    () => (isTauriAvailable(win) ? new DesktopVaultTagRename() : null),
    [win],
  );
  const vaultTagRename = tagRename === undefined ? defaultTagRename : tagRename;
  const defaultThumbs = useMemo(
    () => (isTauriAvailable(win) ? createDesktopThumbnailStore() : null),
    [win],
  );
  const thumbStore = thumbnails === undefined ? defaultThumbs : thumbnails;
  const setRootNode = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      setMountedDocument(node.ownerDocument);
    }
  }, []);

  const [vault, setVault] = useState<VaultInfo | null>(initialVault);
  const [onboardingError, setOnboardingError] = useState<string | null>(null);
  const [loadingVault, setLoadingVault] = useState(false);
  const [globalAlert, setGlobalAlert] = useState<{
    message: string;
    type: "error" | "info";
  } | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [showCloseDiscardConfirm, setShowCloseDiscardConfirm] = useState(false);

  // Directory entries cache: folderPath -> VaultEntry[]
  const [directoryMap, setDirectoryMap] = useState<Map<string, VaultEntry[]>>(
    () => new Map(),
  );
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    () => new Set([""]),
  );

  // Background search metadata
  const [allIndexedEntries, setAllIndexedEntries] = useState<VaultEntry[]>([]);
  const [isIndexing, setIsIndexing] = useState(false);
  const [recoveryCount, setRecoveryCount] = useState(0);

  // UI state
  const [navigatorCollapsed, setNavigatorCollapsed] = useState(() =>
    getNavigatorCollapsed(win),
  );
  const [searchFocusNonce, setSearchFocusNonce] = useState(0);
  const [focusRequest, setFocusRequest] = useState<{
    path: string;
    elementId: string;
    containerId: string | null;
    nonce: number;
  } | null>(null);
  const focusNonceRef = useRef(0);
  const [showConflictDialog, setShowConflictDialog] = useState(false);
  const [showRecoveryDialog, setShowRecoveryDialog] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  // Picked when the modal opens, so an open modal never remounts.
  const SettingsModal = useMemo(
    () =>
      (showSettingsModal && settingsModule?.SettingsModal) || LazySettingsModal,
    [showSettingsModal],
  );
  const [settingsPage, setSettingsPage] = useState<SettingsTarget | undefined>(
    undefined,
  );
  // The palette and the mode it opened in (Cmd+P files, Cmd+Shift+P
  // commands); providers are asked when commands mode is first shown.
  const [switcher, setSwitcher] = useState<PaletteMode | null>(null);
  // One-shot navigator actions triggered from the palette.
  const [navigatorRequest, setNavigatorRequest] =
    useState<NavigatorRequest | null>(null);
  const requestNavigator = (action: NavigatorAction) =>
    setNavigatorRequest((prev) => ({
      ...action,
      nonce: (prev?.nonce ?? 0) + 1,
    }));
  // Colour theme + mode: tokens, html.dark, canvas sync (see useAppearance).
  const appearance = useAppearance(doc, win);
  const { refresh: refreshAppearance } = appearance;
  const appTheme = appearance.snapshot.mode;
  // The thumbnail service lives in ThumbnailsRoot (see there); save notices
  // reach it through this ref.
  const thumbServiceRef = useRef<ThumbnailService | null>(null);
  useInterfaceZoom(win);
  // Per-vault settings.toml overrides merged over config.toml (vault > global).
  const vaultSettings = useVaultSettings(win, vault);
  const { navigatorSort, newDrawingFolder, templatesFolder } =
    vaultSettings.effective;
  // One preferences read per render (localStorage parse + normalise).
  const prefsNow = getPreferences(win);
  const { confirmDelete, showTagChips } = prefsNow;
  const {
    activityBar: activityBarOn,
    activityBarOrder,
    activityBarHidden,
  } = vaultSettings.effective;

  const handleCanvasThemeChange = useCallback(
    (newTheme: "light" | "dark" | "system") => {
      setTheme(newTheme, win);
      refreshAppearance();
    },
    [win, refreshAppearance],
  );

  // Stable identities keep VaultEditor's memo intact across autosave status ticks.
  const exportEditorFile = useCallback(
    (name: string, bytes: Uint8Array) => repository.exportFile(name, bytes),
    [repository],
  );

  const vaultOpen = vault !== null;
  useEffect(() => {
    if (vaultOpen) {
      prefetchSettings();
    }
  }, [vaultOpen]);

  // Live config folder sync: config.toml edits (by hand or another window)
  // reload preferences; re-render so autosave delay and defaults follow
  // (useAppearance re-applies the theme itself).
  const [, setPreferencesVersion] = useState(0);
  // Settings and theme problems get their own persistent banner: unrelated
  // setGlobalAlert(null) calls must not hide a still-broken config.
  const [settingsProblems, setSettingsProblems] = useState<string[]>(() =>
    getSettingsStatus().problems.map((p) => p.message),
  );
  const [dismissedProblem, setDismissedProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!win) {
      return;
    }
    const showSettingsStatus = (settingsStatus: SettingsStatus) => {
      const next = settingsStatus.problems.map((p) => p.message);
      setSettingsProblems((prev) =>
        prev.length === next.length && prev.every((m, i) => m === next[i])
          ? prev
          : next,
      );
    };
    const handlePreferencesChanged = () => {
      setNavigatorCollapsed(getNavigatorCollapsed(win));
      setPreferencesVersion((v) => v + 1);
    };
    const handleStatus = (event: Event) => {
      const detail = (event as CustomEvent<SettingsStatus>).detail;
      showSettingsStatus(detail ?? getSettingsStatus());
    };
    showSettingsStatus(getSettingsStatus());
    win.addEventListener(PREFERENCES_CHANGED_EVENT, handlePreferencesChanged);
    win.addEventListener(SETTINGS_STATUS_EVENT, handleStatus);
    return () => {
      win.removeEventListener(
        PREFERENCES_CHANGED_EVENT,
        handlePreferencesChanged,
      );
      win.removeEventListener(SETTINGS_STATUS_EVENT, handleStatus);
    };
  }, [win]);

  const allProblems = [
    ...settingsProblems,
    ...vaultSettings.problems.map((p) => p.message),
    ...(appearance.snapshot.problem ? [appearance.snapshot.problem] : []),
    ...(appearance.registry.loadError ? [appearance.registry.loadError] : []),
  ];
  const problemText = allProblems.length
    ? allProblems.length > 1
      ? `${allProblems[0]} (and ${allProblems.length - 1} more)`
      : allProblems[0]
    : null;
  const visibleProblem =
    problemText && problemText !== dismissedProblem ? problemText : null;
  // Once fixed, the same problem coming back is shown again.
  useEffect(() => {
    if (!problemText) {
      setDismissedProblem(null);
    }
  }, [problemText]);

  // Refs for tracking active lifecycle, generations, and loaded folders
  useEffect(() => {
    void libraryStore.setVault(vault?.handle ?? null, vault?.readOnly ?? false);
  }, [libraryStore, vault?.handle, vault?.readOnly]);

  const vaultRef = useRef<VaultInfo | null>(vault);
  vaultRef.current = vault;
  const vaultGeneration = useRef(0);
  const directoryMapRef = useRef(directoryMap);
  directoryMapRef.current = directoryMap;
  const indexTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appWinRef = useRef<any>(null);
  const closePromiseRef = useRef<Promise<void> | null>(null);
  const closeAttemptRef = useRef(false);
  const reopenEffectGeneration = useRef(0);

  useEffect(() => {
    if (win) {
      setNavigatorCollapsed(getNavigatorCollapsed(win));
    }
  }, [win]);

  // Editor document hook
  const docHook = useVaultDocument(repository, vault, {
    autosaveDelayMs: prefsNow.autosaveDelayMs,
    history,
    onDrawingSaved: (path, revision) =>
      thumbServiceRef.current?.noteSaved(path, revision),
  });
  const {
    document: activeDoc,
    status: saveStatus,
    error: saveError,
    open: openDoc,
    create: createDoc,
    change: changeDoc,
    flush: flushDoc,
    close: closeDoc,
    reload: reloadDoc,
    saveCopy: saveCopyDoc,
    relocate: relocateDoc,
  } = docHook;

  const docHookRef = useRef(docHook);
  docHookRef.current = docHook;
  const tabsRef = useRef<TabsApi | null>(null);

  // One close path serves both window close and app-wide Quit. Keep the editor
  // frozen after a failed flush until the user explicitly keeps editing/discards.
  const flushAndDestroy = useCallback(() => {
    if (closePromiseRef.current) {
      return closePromiseRef.current;
    }
    if (closeAttemptRef.current) {
      return Promise.resolve();
    }
    closeAttemptRef.current = true;
    setIsClosing(true);
    const operation = (async () => {
      try {
        tabsRef.current?.prepareLeave();
        await docHookRef.current.flush();
        await libraryStore.flush();
        await appWinRef.current?.destroy();
        setShowCloseDiscardConfirm(false);
      } catch {
        setShowCloseDiscardConfirm(true);
      } finally {
        closePromiseRef.current = null;
      }
    })();
    closePromiseRef.current = operation;
    return operation;
  }, [libraryStore]);

  useEffect(() => {
    let unlistenClose: (() => void) | undefined;
    let unlistenQuit: (() => void) | undefined;
    let disposed = false;

    (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const { listen } = await import("@tauri-apps/api/event");
        const appWin = getCurrentWindow();
        appWinRef.current = appWin;
        unlistenClose = await appWin.onCloseRequested((event) => {
          event.preventDefault();
          void flushAndDestroy();
        });
        unlistenQuit = await listen("vault-quit-request", () => {
          void flushAndDestroy();
        });
        if (disposed) {
          unlistenClose();
          unlistenQuit();
        }
      } catch {
        // Not running inside Tauri window.
      }
    })();

    return () => {
      disposed = true;
      unlistenClose?.();
      unlistenQuit?.();
    };
  }, [flushAndDestroy]);

  // Explicit Save action wired to flushDoc (file.save command and UI Save button)
  const handleExplicitSave = useCallback(async () => {
    if (!activeDoc || vault?.readOnly || isBusy || isClosing) {
      return;
    }
    try {
      // Saving must not end an in-progress text edit (Excalidraw keeps typing).
      await flushDoc({ commitText: false });
    } catch (err) {
      setGlobalAlert({
        message: `Save failed: ${errorMessage(err)}`,
        type: "error",
      });
    }
  }, [activeDoc, flushDoc, isBusy, isClosing, vault?.readOnly]);

  // Keep cached listings and expanded folders in step with a folder that was
  // moved (`to`) or removed (`to === null`), along with everything inside it.
  const rebaseFolders = useCallback(
    (from: string, to: string | null) => {
      if (!vault) {
        return;
      }
      setDirectoryMap((prev) => {
        const next = new Map<string, VaultEntry[]>();
        for (const [dir, items] of prev) {
          const rebased = rebaseFolderPath(dir, from, to);
          if (rebased !== null && (rebased === dir || !prev.has(rebased))) {
            next.set(rebased, items);
          }
        }
        return next;
      });
      setExpandedFolders((prev) => {
        const next = new Set<string>();
        for (const dir of prev) {
          const rebased = rebaseFolderPath(dir, from, to);
          if (rebased !== null) {
            next.add(rebased);
          }
        }
        saveExpandedFolders(vault.path, Array.from(next), win);
        return next;
      });
    },
    [vault, win],
  );

  // Load a directory's entries with generation check and error surfacing
  const loadDirectory = useCallback(
    async (dirPath: string, expectedGen?: number) => {
      if (!vault) {
        return;
      }
      const gen = expectedGen ?? vaultGeneration.current;
      try {
        const items = await repository.listDirectory(vault.handle, dirPath);
        if (gen !== vaultGeneration.current) {
          return;
        }
        setDirectoryMap((prev) => {
          const next = new Map(prev);
          next.set(dirPath, items);
          return next;
        });
      } catch (err) {
        if (gen !== vaultGeneration.current) {
          return;
        }
        if (dirPath !== "" && isNotFoundError(err)) {
          // Moved, renamed or deleted (here or outside the app): not an error.
          rebaseFolders(dirPath, null);
          return;
        }
        setGlobalAlert({
          message: `Could not load folder "${
            dirPath || "root"
          }": ${errorMessage(err)}`,
          type: "error",
        });
      }
    },
    [repository, vault, rebaseFolders],
  );

  // Background indexing with cancellation and generation guard
  const startIndexing = useCallback(
    (signal?: AbortSignal, expectedGen?: number) => {
      if (!vault) {
        return;
      }
      const gen = expectedGen ?? vaultGeneration.current;
      setIsIndexing(true);
      const isCurrent = () =>
        gen === vaultGeneration.current && !signal?.aborted;
      const throttle = createProgressThrottle((snapshot) => {
        if (isCurrent()) {
          setAllIndexedEntries(snapshot);
        }
      });
      scanVaultMetadata(repository, vault.handle, signal, (progress) =>
        throttle.push(progress),
      )
        .then((finalList) => {
          throttle.cancel();
          if (isCurrent()) {
            setAllIndexedEntries(finalList);
          }
          setIsIndexing(false);
        })
        .catch(() => {
          throttle.cancel();
          setIsIndexing(false);
        });
    },
    [repository, vault],
  );

  // Refresh recovery count with generation guard
  const refreshRecovery = useCallback(
    async (expectedGen?: number) => {
      if (!vault) {
        return;
      }
      const gen = expectedGen ?? vaultGeneration.current;
      try {
        const items = await repository.listRecovery(vault.handle);
        if (gen === vaultGeneration.current) {
          setRecoveryCount(items.length);
        }
      } catch {
        if (gen === vaultGeneration.current) {
          setRecoveryCount(0);
        }
      }
    },
    [repository, vault],
  );

  // Initial vault setup & reopen: coalesced/idempotent, never leaves cancelled handle open
  useEffect(() => {
    if (initialVault) {
      return;
    }
    let cancelled = false;
    const effectGeneration = ++reopenEffectGeneration.current;

    repository
      .reopenVault()
      .then((reopened) => {
        if (cancelled) {
          // StrictMode immediately re-runs effects on this same instance. Defer
          // release so the replacement effect can claim the coalesced handle.
          queueMicrotask(() => {
            if (
              reopened &&
              reopenEffectGeneration.current === effectGeneration
            ) {
              void repository.releaseVault(reopened.handle).catch(() => {});
            }
          });
          return;
        }
        // Do not overwrite if a vault was already chosen in the meantime
        if (vaultRef.current) {
          if (reopened) {
            void repository.releaseVault(reopened.handle).catch(() => {});
          }
          return;
        }
        if (reopened) {
          setVault(reopened);
          addRecentVault(reopened.path, win);
        }
      })
      .catch(() => {
        // Reopen error handled gracefully
      });

    return () => {
      cancelled = true;
    };
  }, [initialVault, repository, win]);

  // When active vault changes: initialize directories, indexing, watching
  useEffect(() => {
    if (!vault) {
      setDirectoryMap(new Map());
      setAllIndexedEntries([]);
      setRecoveryCount(0);
      return;
    }

    const currentGen = vaultGeneration.current;
    const abortController = new AbortController();

    // Restore expanded folders from preferences keyed by STABLE vault.path
    const savedExpanded = getExpandedFolders(vault.path, win);
    const initialSet = new Set(["", ...savedExpanded]);
    setExpandedFolders(initialSet);

    // Load root directory and expanded folders
    void loadDirectory("", currentGen);
    for (const folder of savedExpanded) {
      if (folder) {
        void loadDirectory(folder, currentGen);
      }
    }

    // Start background scan and check recovery
    startIndexing(abortController.signal, currentGen);
    void refreshRecovery(currentGen);

    // Watcher subscription: handle late .then(off) cleanup
    let disposed = false;
    let unsubscribe: (() => void) | undefined;

    const scheduleCoalescedIndex = () => {
      if (indexTimeoutRef.current) {
        clearTimeout(indexTimeoutRef.current);
      }
      indexTimeoutRef.current = setTimeout(() => {
        if (!disposed && currentGen === vaultGeneration.current) {
          startIndexing(abortController.signal, currentGen);
        }
      }, 500);
    };

    repository
      .subscribe((event: VaultChange) => {
        if (
          disposed ||
          event.handle !== vault.handle ||
          currentGen !== vaultGeneration.current
        ) {
          return;
        }

        if (event.rescan) {
          void loadDirectory("", currentGen);
          scheduleCoalescedIndex();
          void refreshRecovery(currentGen);
          return;
        }

        // Re-read affected loaded directories directly WITHOUT setState updater side-effects
        const loadedDirs = Array.from(directoryMapRef.current.keys());
        for (const dir of loadedDirs) {
          const prefix = dir === "" ? "" : `${dir}/`;
          const touches = event.paths.some(
            (p) =>
              p === dir ||
              (p.startsWith(prefix) && !p.slice(prefix.length).includes("/")),
          );
          if (touches) {
            void loadDirectory(dir, currentGen);
          }
        }

        // Keep search metadata current from affected parent listings; autosaves
        // do not trigger a full recursive scan, while external creates appear.
        void (async () => {
          const parents = new Set(event.paths.map(getParentPath));
          for (const parent of parents) {
            const entries = await repository.listDirectory(
              vault.handle,
              parent,
            );
            if (disposed || currentGen !== vaultGeneration.current) {
              return;
            }
            const entryPaths = new Set(entries.map((entry) => entry.path));
            setAllIndexedEntries((previous) => {
              const removedFolders = previous
                .filter(
                  (entry) =>
                    getParentPath(entry.path) === parent &&
                    entry.kind === "folder" &&
                    !entryPaths.has(entry.path),
                )
                .map((entry) => entry.path);
              return [
                ...previous.filter((entry) => {
                  if (getParentPath(entry.path) === parent) {
                    return false;
                  }
                  return !removedFolders.some((folder) =>
                    entry.path.startsWith(`${folder}/`),
                  );
                }),
                ...entries,
              ];
            });
          }
        })().catch((err) => {
          if (!disposed && currentGen === vaultGeneration.current) {
            setGlobalAlert({
              message: `Could not update search index: ${errorMessage(err)}`,
              type: "error",
            });
          }
        });

        // Refresh recovery count on changes
        void refreshRecovery(currentGen);
      })
      .then((off) => {
        if (disposed) {
          off();
        } else {
          unsubscribe = off;
        }
      })
      .catch((err) => {
        if (!disposed) {
          setGlobalAlert({
            message: `Watcher error: ${errorMessage(err)}`,
            type: "error",
          });
        }
      });

    return () => {
      disposed = true;
      if (indexTimeoutRef.current) {
        clearTimeout(indexTimeoutRef.current);
        indexTimeoutRef.current = null;
      }
      abortController.abort();
      unsubscribe?.();
    };
  }, [loadDirectory, refreshRecovery, repository, startIndexing, vault, win]);

  // Safely switch vaults: flush and close old doc BEFORE releasing old vault handle
  // `sameVault`: swap the current vault's handle for a fresh one (Retry writable).
  const safelySwitchVault = async (chosen: VaultInfo, sameVault = false) => {
    if (!sameVault && vault && chosen.path === vault.path) {
      // Avoid choosing same old root and acquiring a duplicate/read-only clone
      await repository.releaseVault(chosen.handle);
      return;
    }
    const oldVault = vault;
    try {
      // Close old doc first (flushes pending edits). Keep its generation valid
      // until that succeeds so a failed flush leaves the current vault usable.
      tabs.prepareLeave();
      await closeDoc();
      vaultGeneration.current += 1;
      // Release old vault handle ONLY after old doc has flushed and closed
      if (oldVault) {
        await libraryStore.flush();
        await repository.releaseVault(oldVault.handle);
      }
      // Immediately reset directory cache and indexes
      setDirectoryMap(new Map());
      setAllIndexedEntries([]);
      setRecoveryCount(0);
      setVault(chosen);
      addRecentVault(chosen.path, win);
    } catch (err) {
      // The caller owns cleanup of the newly selected handle on failure.
      throw err;
    }
  };

  // Open Vault action
  const handleOpenVault = async () => {
    setGlobalAlert(null);
    setOnboardingError(null);
    setLoadingVault(true);
    let chosen: VaultInfo | null = null;
    try {
      chosen = await repository.chooseVault(false);
      if (chosen) {
        await safelySwitchVault(chosen);
      }
    } catch (err: unknown) {
      if (chosen) {
        try {
          await repository.releaseVault(chosen.handle);
        } catch {}
      }
      const msg = errorMessage(err);
      setOnboardingError(msg);
      setGlobalAlert({ message: msg, type: "error" });
    } finally {
      setLoadingVault(false);
    }
  };

  // Create Vault action
  const handleCreateVault = async () => {
    setGlobalAlert(null);
    setOnboardingError(null);
    setLoadingVault(true);
    let chosen: VaultInfo | null = null;
    try {
      chosen = await repository.chooseVault(true);
      if (chosen) {
        await safelySwitchVault(chosen);
      }
    } catch (err: unknown) {
      if (chosen) {
        try {
          await repository.releaseVault(chosen.handle);
        } catch {}
      }
      const msg = errorMessage(err);
      setOnboardingError(msg);
      setGlobalAlert({ message: msg, type: "error" });
    } finally {
      setLoadingVault(false);
    }
  };

  // Read-only badge / palette "Retry opening vault writable" (toimprove #40):
  // a fresh handle replaces the read-only one once the lock is free.
  const handleRetryWritable = async () => {
    if (!vault?.readOnly || !repository.retryVault) {
      return;
    }
    let next: VaultInfo | null = null;
    try {
      next = await repository.retryVault(vault.handle);
      if (next.readOnly) {
        const still = next;
        next = null;
        await repository.releaseVault(still.handle).catch(() => {});
        toastStore.push({
          message: `Still read-only: ${describeReadOnly(still).detail}`,
        });
        return;
      }
      await safelySwitchVault(next, true);
      next = null;
      toastStore.push({ message: `${vault.name} is writable again` });
    } catch (err: unknown) {
      if (next) {
        await repository.releaseVault(next.handle).catch(() => {});
      }
      setGlobalAlert({
        message: `Could not reopen the vault: ${errorMessage(err)}`,
        type: "error",
      });
    }
  };

  // Switch vault action (await flush before switching; no unsupported discard branch)
  const handleSwitchVault = async () => {
    setGlobalAlert(null);
    let chosen: VaultInfo | null = null;
    setIsBusy(true);
    try {
      chosen = await repository.chooseVault(false);
      if (chosen) {
        await safelySwitchVault(chosen);
      }
    } catch (err: unknown) {
      if (chosen) {
        try {
          await repository.releaseVault(chosen.handle);
        } catch {}
      }
      const msg = errorMessage(err);
      setGlobalAlert({ message: `Cannot switch vault: ${msg}`, type: "error" });
    } finally {
      setIsBusy(false);
    }
  };

  // Toggle navigator collapse
  const handleToggleNavigator = () => {
    setNavigatorCollapsed((prev) => {
      const next = !prev;
      saveNavigatorCollapsed(next, win);
      return next;
    });
  };

  // Toggle folder expansion in tree using STABLE vault.path
  const handleToggleFolder = (folderPath: string) => {
    if (!vault) {
      return;
    }
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) {
        next.delete(folderPath);
      } else {
        next.add(folderPath);
        void loadDirectory(folderPath);
      }
      saveExpandedFolders(vault.path, Array.from(next), win);
      return next;
    });
  };

  const handleCollapseAllFolders = () => {
    if (!vault) {
      return;
    }
    setExpandedFolders(new Set());
    saveExpandedFolders(vault.path, [], win);
  };

  const refreshFiles = () => {
    void loadDirectory("");
    for (const f of expandedFolders) {
      if (f) {
        void loadDirectory(f);
      }
    }
    startIndexing();
    void refreshRecovery();
  };

  const handleExpandFolder = (folderPath: string) => {
    if (!vault) {
      return;
    }
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      next.add(folderPath);
      void loadDirectory(folderPath);
      saveExpandedFolders(vault.path, Array.from(next), win);
      return next;
    });
  };

  // Stable props for the memoised HistoryHost (it would re-render on every
  // VaultApp render otherwise).
  const historySettings = useMemo(
    () => toHistorySettings(vaultSettings.effective),
    [vaultSettings.effective],
  );
  const flushHistory = useCallback(
    () => flushDoc({ commitText: false }),
    [flushDoc],
  );
  const openDrawingRef = useRef<((path: string) => Promise<unknown>) | null>(
    null,
  );
  const openFromHistory = useCallback(
    (path: string) => void openDrawingRef.current?.(path),
    [],
  );

  // Open drawing with busy freeze and error catching
  /** False when the open failed (an alert says why). */
  // Rejects on failure (the tabs controller rolls back on it).
  const openWithFreeze = async (drawingPath: string) => {
    setIsBusy(true);
    setGlobalAlert(null);
    try {
      await openDoc(drawingPath);
    } catch (err) {
      // A restored session naming a deleted file is not worth an alert.
      if (!(tabs.isRestoring() && isNotFoundError(err))) {
        setGlobalAlert({
          message: `Failed to open drawing: ${errorMessage(err)}`,
          type: "error",
        });
      }
      throw err;
    } finally {
      setIsBusy(false);
    }
  };
  const handleOpenDrawing = async (
    drawingPath: string,
    opts?: { target?: OpenTarget },
  ) => {
    if (tabs.enabled) {
      return tabs.open(drawingPath, opts?.target);
    }
    try {
      await openWithFreeze(drawingPath);
      return true;
    } catch {
      return false;
    }
  };

  // Search result: open the drawing (unless active), then focus the element.
  const handleOpenSearchResult = async (
    drawingPath: string,
    match?: { elementId: string; containerId: string | null },
    opts?: { target?: OpenTarget },
  ) => {
    if (drawingPath !== activeDoc?.path) {
      await handleOpenDrawing(drawingPath, opts);
    }
    if (match) {
      setFocusRequest({
        path: drawingPath,
        elementId: match.elementId,
        containerId: match.containerId,
        nonce: ++focusNonceRef.current,
      });
    }
  };

  // Create drawing
  // Throwing core shared by the UI handlers and the control API: create the
  // document (blank with the default paper, or from scene JSON), open it, refresh.
  const createEntryCore = async (
    parentPath: string,
    name: string,
    json?: string,
  ) => {
    tabs.captureActive();
    if (json === undefined) {
      await createDoc(parentPath, name, newDrawingAppState());
    } else {
      await createDoc(parentPath, name, undefined, json);
    }
    await tabs.openCreated(joinPath(parentPath, name));
    await loadDirectory(parentPath);
    handleExpandFolder(parentPath);
    startIndexing();
  };

  const newDrawingAppState = () => {
    const prefs = getPreferences(win);
    const paper = {
      viewBackgroundColor:
        prefs.defaultCanvasBackground ||
        (appTheme === "dark" ? "#121212" : "#ffffff"),
      viewBackgroundPattern: getDefaultBackgroundPattern(win),
      pageSetup: null,
    };
    // Page mode default: the paper theme stamps the page colours
    const pageSetup = getNewDrawingPageSetup(win);
    const initialAppState = {
      theme: appTheme,
      ...paper,
      ...(pageSetup && getPageSetupPatch(paper, pageSetup)),
      currentItemFontFamily: prefs.defaultFontFamily,
      currentItemFontSize: prefs.defaultFontSize,
      currentItemStrokeColor: prefs.defaultStrokeColor,
      currentItemBackgroundColor: prefs.defaultBackgroundColor,
      currentItemFillStyle: prefs.defaultFillStyle,
      currentItemStrokeWidth: prefs.defaultStrokeWidth,
      currentItemRoughness: prefs.defaultRoughness,
    };
    return initialAppState;
  };

  const handleCreateDrawing = async (parentPath: string, name: string) => {
    setIsBusy(true);
    setGlobalAlert(null);
    try {
      await createEntryCore(parentPath, name);
    } catch (err) {
      setGlobalAlert({
        message: `Failed to create drawing: ${errorMessage(err)}`,
        type: "error",
      });
    } finally {
      setIsBusy(false);
    }
  };

  // New drawing from the header / empty state: honours the default folder
  // setting (created when missing); otherwise next to the open drawing.
  // Resolves the parent folder for a new drawing (creating the default
  // folder when missing). null = aborted (error already shown).
  const prepareNewDrawingParent = async (): Promise<string | null> => {
    if (!vault) {
      return null;
    }
    const parent = resolveNewDrawingParent(
      newDrawingFolder,
      activeDoc?.path ?? null,
    );
    if (newDrawingFolder && !vault.readOnly) {
      try {
        const created = await ensureFolder(repository, vault.handle, parent);
        if (created.length > 0) {
          const chain = ["", ...folderChain(parent)];
          for (const folder of chain.slice(0, -1)) {
            await loadDirectory(folder);
            if (folder) {
              handleExpandFolder(folder);
            }
          }
        }
      } catch (err) {
        setGlobalAlert({
          message: `Could not create the default folder "${parent}": ${errorMessage(
            err,
          )}`,
          type: "error",
        });
        return null;
      }
    }
    return parent;
  };

  const handleNewDrawing = async () => {
    const parent = await prepareNewDrawingParent();
    if (parent !== null) {
      await handleCreateDrawing(
        parent,
        `Drawing-${Date.now().toString().slice(-4)}.excalidraw`,
      );
    }
  };

  // Create a drawing from a ready scene JSON (templates).
  const handleCreateFromJson = async (
    parentPath: string,
    name: string,
    json: string,
  ) => {
    setIsBusy(true);
    setGlobalAlert(null);
    try {
      await createEntryCore(parentPath, name, json);
    } finally {
      setIsBusy(false);
    }
  };

  const templates = useTemplates({
    repository,
    vault,
    folder: templatesFolder,
    doc,
    theme: appTheme,
    activePath: activeDoc?.path ?? null,
    flushActive: () => flushDoc({ commitText: false }),
    prepareParent: prepareNewDrawingParent,
    createFromJson: handleCreateFromJson,
    newBlank: () => void handleNewDrawing(),
    onError: (message) => setGlobalAlert({ message, type: "error" }),
  });
  const { openPicker: openTemplatePicker } = templates;

  // Links: history, dock, create, links-aware rename/move, commands.
  useLinkDisplayPrefs(win); // palette toggles re-render with the new prefs
  const linksSettings = useMemo(
    () => getLinksSettings(prefsNow),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      prefsNow.linkNewFormat,
      prefsNow.linkShapeFormat,
      prefsNow.linkOpenModifier,
      prefsNow.linkUpdateOnRename,
      prefsNow.linkAutocomplete,
      prefsNow.linkHintChars,
      prefsNow.linkStyle,
      prefsNow.linkColor,
      prefsNow.linkHoverPreview,
    ],
  );
  const palettePick = usePalettePick();
  const appLinks = useAppLinks({
    links: vaultLinks,
    search: vaultSearch,
    repository,
    vault,
    win,
    doc,
    settings: linksSettings,
    entries: allIndexedEntries,
    indexing: isIndexing,
    activePath: activeDoc?.path ?? null,
    navigatorCollapsed,
    // Tabs are created below; these read the store live through the ref.
    activeTabId: tabsRef.current?.getActiveId() ?? null,
    getActiveTabId: () => tabsRef.current?.getActiveId() ?? null,
    openTabIds: () => tabsRef.current?.openIds() ?? new Set<string>(),
    open: (path, elementId, target = "current") =>
      handleOpenSearchResult(
        path,
        elementId ? { elementId, containerId: null } : undefined,
        { target },
      ),
    prepareParent: prepareNewDrawingParent,
    createDrawing: handleCreateDrawing,
    loadDirectory,
    expandFolder: handleExpandFolder,
    showNavigator: () => showNavigator(),
    openHotkeys: () => openSettings("hotkeys"),
    notify: (message, type) => {
      // Confirmations are toasts; failures stay a banner until dismissed.
      if (type === "info") {
        toastStore.push({ message });
      } else {
        setGlobalAlert({ message, type });
      }
    },
  });
  const tagsSettings = useMemo(
    () => getTagsSettings(prefsNow),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prefsNow.tagAutocomplete, prefsNow.tagPaneSort],
  );
  const appTags = useAppTags({
    api: vaultTagRename,
    links: vaultLinks,
    handle: vault?.handle ?? null,
    activePath: activeDoc?.path ?? null,
    bridge: appLinks.bridge,
    flushActive: () => flushDoc({ commitText: false }),
    notify: (message, type) => {
      setGlobalAlert({ message, type });
      if (type === "info") {
        (win ?? window).setTimeout(
          () => setGlobalAlert((a) => (a?.message === message ? null : a)),
          6000,
        );
      }
    },
    doc,
  });
  const editorLinks = useMemo(
    () =>
      vaultLinks
        ? {
            settings: linksSettings,
            tagsSettings,
            names: appLinks.names,
            currentPath: activeDoc?.path ?? null,
            callbacks: appLinks.editorCallbacks,
            links: vaultLinks,
            handle: vault?.handle ?? null,
            pickDrawing: palettePick.pickDrawing,
            bridge: appLinks.bridge,
            remeasureIds: appLinks.remeasureIdsFor(activeDoc?.path ?? null),
            onRemeasured: () => appLinks.onRemeasured(activeDoc?.path ?? null),
            readDrawing: (path: string) =>
              vault
                ? repository.readDrawing(vault.handle, path)
                : Promise.reject(new Error("no vault")),
          }
        : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      vaultLinks,
      linksSettings,
      tagsSettings,
      appLinks.names,
      appLinks.editorCallbacks,
      activeDoc?.path,
      vault?.handle,
      palettePick.pickDrawing,
    ],
  );

  // Create folder
  const handleCreateFolder = async (parentPath: string, name: string) => {
    if (!vault) {
      return;
    }
    setIsBusy(true);
    setGlobalAlert(null);
    try {
      const path = joinPath(parentPath, name);
      await repository.createFolder(vault.handle, path);
      await loadDirectory(parentPath);
      handleExpandFolder(parentPath);
      handleExpandFolder(path);
      startIndexing();
    } catch (err) {
      setGlobalAlert({
        message: `Failed to create folder: ${errorMessage(err)}`,
        type: "error",
      });
    } finally {
      setIsBusy(false);
    }
  };

  // One path for rename, move and drag-and-drop: links-aware (see useAppLinks).
  // The open drawing is flushed and relocated by relocateDoc as before.
  const moveWithLinks = (
    from: string,
    to: string,
    silent?: { rewriteLinks: boolean },
  ) =>
    appLinks.moveEntry(
      from,
      to,
      (move) =>
        activeDoc &&
        (activeDoc.path === from || activeDoc.path.startsWith(`${from}/`))
          ? relocateDoc(from, to, move)
          : move(from, to).then(() => undefined),
      silent,
    );

  // Throwing core of rename/move; `destParent` also reloads and expands the
  // destination folder. false = aborted by the user.
  const moveEntryCore = async (
    sourcePath: string,
    newPath: string,
    destParent?: string,
    silent?: { rewriteLinks: boolean },
  ): Promise<boolean> => {
    if (!(await moveWithLinks(sourcePath, newPath, silent))) {
      return false;
    }
    tabs.renamed(sourcePath, newPath);
    rebaseFolders(sourcePath, newPath);
    await loadDirectory(getParentPath(sourcePath));
    if (destParent !== undefined) {
      await loadDirectory(destParent);
      handleExpandFolder(destParent);
    }
    startIndexing();
    return true;
  };

  // Rename entry
  const handleRenameEntry = async (oldPath: string, newName: string) => {
    if (!vault) {
      return;
    }
    setIsBusy(true);
    setGlobalAlert(null);
    try {
      const parent = getParentPath(oldPath);
      const newPath = joinPath(parent, newName);

      await moveEntryCore(oldPath, newPath);
    } catch (err) {
      setGlobalAlert({
        message: `Failed to rename: ${errorMessage(err)}`,
        type: "error",
      });
    } finally {
      setIsBusy(false);
    }
  };

  // Move entry
  const handleMoveEntry = async (
    sourcePath: string,
    destinationParentPath: string,
  ) => {
    if (!vault) {
      return;
    }
    setIsBusy(true);
    setGlobalAlert(null);
    try {
      const base = getBaseName(sourcePath);
      const newPath = joinPath(destinationParentPath, base);
      await moveEntryCore(sourcePath, newPath, destinationParentPath);
    } catch (err) {
      setGlobalAlert({
        message: `Failed to move: ${errorMessage(err)}`,
        type: "error",
      });
    } finally {
      setIsBusy(false);
    }
  };

  // Duplicate drawing: FLUSH ACTIVE DRAWING BEFORE READ to copy latest edits
  const handleDuplicateDrawing = async (path: string) => {
    if (!vault) {
      return;
    }
    setIsBusy(true);
    setGlobalAlert(null);
    try {
      if (activeDoc && activeDoc.path === path) {
        await flushDoc({ commitText: false });
      }
      const file = await repository.readDrawing(vault.handle, path);
      let target = duplicateName(path);
      const knownPaths = new Set(allIndexedEntries.map((e) => e.path));
      while (knownPaths.has(target)) {
        target = duplicateName(target);
      }
      const opId = `dup-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await repository.writeDrawing({
        handle: vault.handle,
        path: target,
        json: file.json,
        expectedRevision: null,
        operationId: opId,
      });
      const parent = getParentPath(target);
      await loadDirectory(parent);
      startIndexing();
      tabs.captureActive();
      await openDoc(target);
      await tabs.openCreated(target);
    } catch (err) {
      setGlobalAlert({
        message: `Failed to duplicate drawing: ${errorMessage(err)}`,
        type: "error",
      });
    } finally {
      setIsBusy(false);
    }
  };

  // Throwing core of trash (the control API calls it too).
  const trashEntryCore = async (path: string) => {
    if (!vault) {
      return;
    }
    let closedActive = false;
    try {
      if (
        activeDoc &&
        (activeDoc.path === path || activeDoc.path.startsWith(`${path}/`))
      ) {
        await closeDoc();
        closedActive = true;
      }
      await repository.trash(vault.handle, path);
      await tabs.removed(path);
      rebaseFolders(path, null);
      const parent = getParentPath(path);
      await loadDirectory(parent);
      startIndexing();
    } catch (err) {
      if (closedActive) {
        tabs.resync(); // the document was closed but the file is still there
      }
      throw err;
    }
  };

  // Trash entry
  const handleTrashEntry = async (path: string) => {
    if (!vault) {
      return;
    }
    setIsBusy(true);
    setGlobalAlert(null);
    try {
      await trashEntryCore(path);
    } catch (err) {
      setGlobalAlert({
        message: `Failed to trash entry: ${errorMessage(err)}`,
        type: "error",
      });
    } finally {
      setIsBusy(false);
    }
  };

  // Reveal entry in OS file manager
  const handleRevealEntry = async (path: string) => {
    if (!vault) {
      return;
    }
    try {
      await repository.reveal(vault.handle, path);
    } catch (err) {
      setGlobalAlert({
        message: `Failed to reveal entry: ${errorMessage(err)}`,
        type: "error",
      });
    }
  };

  const handleRevealRecovery = async () => {
    if (!vault) {
      return;
    }
    try {
      await repository.revealRecovery(vault.handle);
    } catch (err) {
      setGlobalAlert({
        message: `Failed to open the recovery folder: ${errorMessage(err)}`,
        type: "error",
      });
    }
  };

  const handleExportDrawing = useExplorerExport({
    repository,
    vault,
    win: win as (Window & typeof globalThis) | null,
    dark: appTheme === "dark",
    flushIfOpen: async (path) => {
      if (activeDoc?.path === path) {
        await flushDoc({ commitText: false });
      }
    },
    setAlert: setGlobalAlert,
  });

  // Open recovered snapshot as copy
  const handleOpenRecovered = async (targetPath: string, json: string) => {
    if (!vault) {
      return;
    }
    setIsBusy(true);
    setGlobalAlert(null);
    try {
      const opId = `rec-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await repository.writeDrawing({
        handle: vault.handle,
        path: targetPath,
        json,
        expectedRevision: null,
        operationId: opId,
      });
      const parent = getParentPath(targetPath);
      await loadDirectory(parent);
      startIndexing();
      tabs.captureActive();
      await openDoc(targetPath);
      await tabs.openCreated(targetPath);
    } catch (err) {
      setGlobalAlert({
        message: `Failed to open recovered snapshot: ${errorMessage(err)}`,
        type: "error",
      });
    } finally {
      setIsBusy(false);
    }
  };

  const handleReloadConflict = async () => {
    setIsBusy(true);
    try {
      await reloadDoc();
    } finally {
      setIsBusy(false);
    }
  };

  const handleSaveConflictCopy = async (path: string) => {
    setIsBusy(true);
    try {
      await saveCopyDoc(path);
    } finally {
      setIsBusy(false);
    }
  };

  const openSettings = useCallback((page?: SettingsTarget) => {
    setSettingsPage(page);
    setShowSettingsModal(true);
  }, []);

  const showNavigator = () => {
    commitCanvasTextEdit(doc);
    setNavigatorCollapsed((collapsed) => {
      if (collapsed) {
        saveNavigatorCollapsed(false, win);
      }
      return false;
    });
  };

  // Tabs: expand the navigator to a drawing and focus its row.
  const revealInNavigator = (path: string) => {
    showNavigator();
    ancestorFolders(path).forEach(handleExpandFolder);
    requestNavigator({ kind: "reveal", path });
  };
  // Tabs: the palette's Enter opens in a new tab (file.openInNewTab).
  const switcherNewTab = useRef(false);
  useEffect(() => {
    if (!switcher) {
      switcherNewTab.current = false;
    }
  }, [switcher]);

  const focusNavigatorSearch = () => {
    showNavigator();
    setSearchFocusNonce((n) => n + 1);
  };

  // Write where the value currently lives: this vault if it overrides the
  // global order, else config.toml.
  // Same rule for the activity bar toggle.
  const handleToggleActivityBar = () => {
    if (vaultSettings.isOverridden("activityBar")) {
      void vaultSettings.setOverride("activityBar", !activityBarOn);
    } else {
      updatePreferences({ activityBar: !activityBarOn }, win);
    }
  };

  const handleSortChange = (order: SortOrder) => {
    if (vaultSettings.isOverridden("navigatorSort")) {
      void vaultSettings.setOverride("navigatorSort", order);
    } else {
      updatePreferences({ navigatorSort: order }, win);
    }
  };

  // Graph view (D14): it takes over the canvas area; the editor stays mounted
  // but frozen (no key or pointer handling) and hidden, so closing is instant.
  const [graphOpen, setGraphOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const mainCovered = graphOpen || galleryOpen;
  const { effective: effectiveSettings } = vaultSettings;
  const tabs = useTabs({
    vault,
    settings: {
      ...prefsNow,
      tabsOpenFromNavigator: effectiveSettings.tabsOpenFromNavigator,
      tabsRestore: effectiveSettings.tabsRestore,
    },
    docHook,
    openDocument: openWithFreeze,
    closeDocument: closeDoc,
    notify: (message) => toastStore.push({ message }),
    runCommand: (id) => runnerRef.current?.run(id) ?? false,
    closeOverlays: () => {
      if (graphOpen) {
        void getRegisteredHandler(GRAPH_COMMAND_IDS.open)?.();
      }
      if (galleryOpen) {
        void getRegisteredHandler(THUMBNAIL_COMMAND_IDS.galleryToggle)?.();
      }
    },
    setShowStrip: (tabsShowStrip) => updatePreferences({ tabsShowStrip }, win),
    repository,
    revealInNavigator,
    openPalette: (newTab) => {
      switcherNewTab.current = newTab;
      setSwitcher("files");
    },
    searchFor: (query) => {
      showNavigator();
      requestNavigator({ kind: "search", query });
    },
    entries: allIndexedEntries,
    indexing: isIndexing,
  });
  tabsRef.current = tabs;
  const editorRestore = useMemo(
    () =>
      activeDoc
        ? tabs.restoreFor(activeDoc.path, activeDoc.revision, activeDoc.id)
        : undefined,
    // The restore belongs to one mounted document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeDoc?.id, tabs.restoreFor],
  );
  const shortcutLabel = useCommandShortcutLookup(win);
  const graphShortcutFor = useCallback(
    (path: string) => shortcutLabel(drawingOpenCommandId(path)) || null,
    [shortcutLabel],
  );
  const focusCanvas = useCallback(
    () =>
      doc
        ?.querySelector<HTMLElement>(".vault-editor .excalidraw-container")
        ?.focus({ preventScroll: true }),
    [doc],
  );

  const pdfImport = usePdfImport({
    bridge: pdf,
    getApi: () => (activeDoc ? getEditorApi(activeDoc.id) : undefined),
    getSettings: () => getPdfImportSettings(getPreferences(win)),
    notify: (message, type) => {
      // Confirmations are toasts; failures stay a banner until dismissed.
      if (type === "info") {
        toastStore.push({ message });
      } else {
        setGlobalAlert({ message, type });
      }
    },
  });

  const { start: startPdfImport, openFile: openPdfFile } = pdfImport;
  const pdfControls = useMemo(
    () => ({ start: startPdfImport, openFile: openPdfFile }),
    [startPdfImport, openPdfFile],
  );
  const importFile = useCanvasImport({
    getApi: () => (activeDoc ? getEditorApi(activeDoc.id) : undefined),
    getDocument: () => doc ?? document,
    openPdf: openPdfFile,
    notify: (message) => setGlobalAlert({ message, type: "error" }),
  });

  const runnerRef = useRef<CommandRunner | null>(null);
  const idle = !isBusy && !isClosing;
  const commandHandlers = appCommandHandlers({
    // The save chords never reach Excalidraw (so Cmd+Shift+S can't start its
    // "Save to disk" download). Commit a text edit first, then save after
    // Excalidraw has published the committed scene.
    save: async () => {
      commitCanvasTextEdit(doc);
      await new Promise((resolve) => (win ?? window).setTimeout(resolve, 0));
      return handleExplicitSave();
    },
    openSettings: () => openSettings(),
    openHotkeySettings: () => openSettings("hotkeys"),
    focusSearch: focusNavigatorSearch,
    zoom: (command) => runZoomCommand(command, win),
    toggleNavigator: handleToggleNavigator,
    toggleActivityBar: handleToggleActivityBar,
    newDrawing: () => {
      if (idle) {
        return handleNewDrawing();
      }
    },
    newFromTemplate: () => openTemplatePicker(),
    switchVault: () => {
      if (idle) {
        return handleSwitchVault();
      }
    },
    revealActive: () => {
      if (activeDoc) {
        return handleRevealEntry(activeDoc.path);
      }
    },
    duplicateActive: () => {
      if (activeDoc && idle) {
        return handleDuplicateDrawing(activeDoc.path);
      }
    },
    toggleMode: () =>
      handleCanvasThemeChange(appTheme === "dark" ? "light" : "dark"),
    togglePalette: (mode) => {
      if (!switcher) {
        commitCanvasTextEdit(doc);
      }
      // While it is open the palette handles its own keys (same mode closes,
      // the other switches); this path only sees it open via Mod+Enter.
      setSwitcher((open) => (open ? null : mode));
    },
    openSettingsPage: openSettings,
    setMode: handleCanvasThemeChange,
    setSyncCanvas: (on) => {
      updatePreferences({ syncCanvas: on }, win);
      refreshAppearance();
    },
    exportActive: (format) => {
      if (activeDoc) {
        return handleExportDrawing(activeDoc.path, format);
      }
    },
    importPdf: startPdfImport,
    importFile: () => importFile(),
    saveActiveAsTemplate: () => {
      if (activeDoc) {
        templates.requestSave(activeDoc.path);
      }
    },
    searchTags: () => {
      showNavigator();
      requestNavigator({ kind: "search", query: tagQuery("") });
    },
    newFolder: () => requestNavigator({ kind: "newFolder" }),
    newDrawingInFolder: () => requestNavigator({ kind: "newDrawingInFolder" }),
    collapseAllFolders: handleCollapseAllFolders,
    refreshFiles,
    renameActive: () => {
      if (activeDoc) {
        requestNavigator({ kind: "rename", path: activeDoc.path });
      }
    },
    moveActive: () => {
      if (activeDoc) {
        requestNavigator({ kind: "move", path: activeDoc.path });
      }
    },
    trashActive: () => {
      if (activeDoc) {
        requestNavigator({ kind: "trash", path: activeDoc.path });
      }
    },
    revealVault: () => handleRevealEntry(""),
    revealRecovery: handleRevealRecovery,
    setSort: handleSortChange,
    openRecovered:
      recoveryCount > 0 ? () => setShowRecoveryDialog(true) : undefined,
    resolveConflict:
      saveStatus === "conflict" ? () => setShowConflictDialog(true) : undefined,
    retryWritable:
      vault?.readOnly && idle ? () => void handleRetryWritable() : undefined,
  });
  const commandRunner = useCommandDispatcher(doc, win, {
    handlers: commandHandlers,
    app: {
      vaultOpen: vault !== null,
      drawingOpen: activeDoc != null,
      writable: !vault?.readOnly,
    },
  });
  runnerRef.current = commandRunner;
  useEffect(() => {
    setPluginCommandRunner((id) => runnerRef.current?.run(id) ?? false);
    return () => setPluginCommandRunner(null);
  }, []);
  useControlBridge(win, {
    tabStore: tabs.store,
    activePath: activeDoc?.path ?? null,
    files: createAppFiles({
      vault,
      repository,
      active: activeDoc
        ? { path: activeDoc.path, dirty: saveStatus !== "saved" }
        : null,
      tabStore: tabs.store,
      activate: tabs.stripProps?.onActivate,
      close: tabs.stripProps?.onClose,
      openVaultAt: async (path) => {
        const chosen = await openVaultAtPath(path);
        try {
          await safelySwitchVault(chosen);
        } catch (err) {
          await repository.releaseVault(chosen.handle).catch(() => {});
          throw err;
        }
        return chosen;
      },
      openDrawing: handleOpenDrawing,
      createEntry: createEntryCore,
      moveEntry: (from, to, rewriteLinks) =>
        moveEntryCore(from, to, getParentPath(to), { rewriteLinks }),
      trashEntry: trashEntryCore,
      busy: async (run) => {
        setIsBusy(true);
        try {
          return await run();
        } finally {
          setIsBusy(false);
        }
      },
    }),
    runner: () => runnerRef.current ?? commandRunner,
    appState: () => ({
      activeDrawing: activeDoc
        ? { path: activeDoc.path, dirty: saveStatus !== "saved" }
        : null,
      tabs: tabs.store?.getState().tabs.length ?? (activeDoc ? 1 : 0),
    }),
    openTarget: async (target, cwd) => {
      const path = vault
        ? resolveOpenTarget(target, cwd, vault.path, (p) =>
            allIndexedEntries.some((e) => e.kind === "drawing" && e.path === p),
          )
        : null;
      if (path === null) {
        return false;
      }
      await appLinks.openLink(path);
      return true;
    },
  });
  const commandHandlersRef = useRef(commandHandlers);
  commandHandlersRef.current = commandHandlers;
  const hasCommandHandler = useCallback(
    (id: string) =>
      !!(commandHandlersRef.current[id] ?? getRegisteredHandler(id)),
    [],
  );
  const isCommandAvailable = useCallback(
    (id: string) =>
      runnerRef.current?.isAvailable(id, { fromPalette: true }) ?? false,
    [],
  );
  const handleGalleryOpenChange = useCallback((open: boolean) => {
    setGalleryOpen(open);
    galleryPanelStore.publish(open);
  }, []);
  const handleGraphOpenChange = useCallback((open: boolean) => {
    setGraphOpen(open);
    graphPanelStore.publish(open);
  }, []);
  // UI entry points (navigator, main menu, row menu) dispatch the graph commands.
  const runCommand = useCallback(
    (id: string) => runnerRef.current?.run(id) ?? false,
    [],
  );
  const { openGraph, openLocalGraph } = useGraphEntry(
    activeDoc?.path ?? null,
    handleOpenDrawing,
    runCommand,
  );
  const { toggleHistory, showHistory } = useHistoryEntry(
    activeDoc?.path ?? null,
    handleOpenDrawing,
    runCommand,
  );

  // Palette providers read live state through this ref, so the provider
  // objects stay stable and nothing runs while the palette is closed.
  const paletteLive = useRef({
    checked: (_id: string): boolean => false,
    registry: appearance.registry,
    refreshAppearance,
  });
  paletteLive.current = {
    checked: (id) => {
      if (id.startsWith("appearance.mode.")) {
        return getTheme(win) === id.slice("appearance.mode.".length);
      }
      if (id.startsWith("appearance.syncCanvas.")) {
        return getPreferences(win).syncCanvas === id.endsWith(".on");
      }
      if (id.startsWith("navigator.sort.")) {
        return navigatorSort === id.slice("navigator.sort.".length);
      }
      if (id.startsWith("page.")) {
        return isPageCommandChecked(id);
      }
      return false;
    },
    registry: appearance.registry,
    refreshAppearance,
  };
  useEffect(() => {
    const live = () => paletteLive.current;
    const runner = {
      run: (id: string, o?: { fromPalette?: boolean }) =>
        runnerRef.current?.run(id, o) ?? false,
      isAvailable: (id: string, o?: { fromPalette?: boolean }) =>
        runnerRef.current?.isAvailable(id, o) ?? false,
      get platform() {
        return runnerRef.current?.platform ?? "mac";
      },
    };
    const stops = [
      registerPaletteProvider(
        createCommandsProvider({
          runner,
          overrides: () => getPreferences(win).hotkeys,
          checked: (id) => live().checked(id),
        }),
      ),
      registerPaletteProvider(
        createThemesProvider({
          registry: () => live().registry,
          currentKey: () =>
            resolveSelectedTheme(
              live().registry,
              getPreferences(win).colorTheme,
            ).entry.key,
          select: (key) => {
            updatePreferences({ colorTheme: key }, win);
            live().refreshAppearance();
          },
        }),
      ),
    ];
    return () => stops.forEach((stop) => stop());
  }, [win]);

  const closeSwitcher = () => setSwitcher(null);
  const runPaletteItem = (item: PaletteItem, keepOpen: boolean) => {
    const execute = async () => {
      try {
        await item.run();
      } catch (err) {
        console.error(`Palette entry "${item.key}" failed`, err);
      }
    };
    if (keepOpen) {
      void execute();
      return;
    }
    setSwitcher(null);
    // After the palette's backdrop has unmounted, so `!modalOpen` holds.
    const timers = win ?? window;
    timers.setTimeout(() => {
      void execute().then(() =>
        // One more tick so a dialog the entry opened can take focus first.
        timers.setTimeout(() => focusCanvasIfIdle(doc), 0),
      );
    }, 0);
  };

  // Build tree nodes for Navigator
  const treeNodes = useMemo(() => {
    return buildTree(directoryMap, "", navigatorSort);
  }, [directoryMap, navigatorSort]);

  // Derived from the index only: not recomputed (5000+ entries) on every
  // render, e.g. when the palette or Settings opens.
  const recentDrawings = useMemo(
    () =>
      allIndexedEntries
        .filter(
          (entry) =>
            entry.kind === "drawing" &&
            !isInTemplatesFolder(entry.path, templatesFolder),
        )
        .sort((a, b) => b.modifiedAt - a.modifiedAt)
        .slice(0, 6),
    [allIndexedEntries, templatesFolder],
  );
  // The palette's fallback list: built when the palette first renders after
  // an index change (never on vault open), then reused on every open.
  const drawingPathsRef = useRef<{
    entries: VaultEntry[];
    paths: string[];
  } | null>(null);
  const drawingPaths = () => {
    if (drawingPathsRef.current?.entries !== allIndexedEntries) {
      drawingPathsRef.current = {
        entries: allIndexedEntries,
        paths: allIndexedEntries
          .filter((e) => e.kind === "drawing")
          .map((e) => e.path)
          .sort(),
      };
    }
    return drawingPathsRef.current.paths;
  };

  const recentVaults = getRecentVaults(win);
  const lastVaultPath = getLastVaultPath(win);

  // If no vault open, render onboarding
  // One wrapper for onboarding and the vault view: the root element type must
  // not change when a vault opens, or React remounts the whole app.
  const withThumbnails = (children: React.ReactNode) => (
    <ThumbnailsRoot
      store={thumbStore}
      repository={repository}
      handle={vault?.handle ?? null}
      win={win}
      appTheme={appTheme}
      serviceRef={thumbServiceRef}
    >
      {children}
    </ThumbnailsRoot>
  );

  if (!vault) {
    return withThumbnails(
      <div
        ref={setRootNode}
        className={`vault-app ${isClosing ? "vault-app--closing" : ""}`}
      >
        {visibleProblem && (
          <Banner
            kind="warning"
            className="vault-settings-alert"
            testId="settings-problem-banner"
            message={visibleProblem}
            onDismiss={() => setDismissedProblem(problemText)}
            dismissLabel="Dismiss settings problem"
          />
        )}
        <Onboarding
          recentVaults={recentVaults}
          lastVaultPath={lastVaultPath}
          onOpenVault={handleOpenVault}
          onCreateVault={handleCreateVault}
          onSelectRecent={async (recentPath) => {
            setOnboardingError(null);
            setGlobalAlert(null);
            setLoadingVault(true);
            let chosen: VaultInfo | null = null;
            try {
              if (recentPath === lastVaultPath) {
                const reopened = await repository.reopenVault();
                if (reopened) {
                  if (reopened.path === recentPath) {
                    chosen = reopened;
                    await safelySwitchVault(reopened);
                    chosen = null;
                    return;
                  }
                  // Reopened a different vault path than requested; release it immediately
                  await repository.releaseVault(reopened.handle);
                }
              }
              // Native desktop only persists the last opened vault for direct reopen.
              // Route to folder picker with explanatory hint:
              setGlobalAlert({
                message: `Native desktop reopens the last vault automatically. Please select "${recentPath}" in the folder picker.`,
                type: "info",
              });
              chosen = await repository.chooseVault(false);
              if (chosen) {
                await safelySwitchVault(chosen);
              }
            } catch (err: unknown) {
              if (chosen) {
                try {
                  await repository.releaseVault(chosen.handle);
                } catch {}
              }
              const msg = errorMessage(err);
              setOnboardingError(msg);
              setGlobalAlert({ message: msg, type: "error" });
            } finally {
              setLoadingVault(false);
            }
          }}
          onRemoveRecent={(p) => removeRecentVault(p, win)}
          error={onboardingError}
          loading={loadingVault}
          ownerWindow={win}
        />
      </div>,
    );
  }

  const EditorComponent = VaultEditor as React.ComponentType<
    React.ComponentProps<typeof VaultEditor> & {
      readOnly?: boolean;
      disabled?: boolean;
      theme?: "light" | "dark";
      onThemeChange?: (theme: "light" | "dark" | "system") => void;
    }
  >;

  openDrawingRef.current = handleOpenDrawing;
  const editorLoading = isBusy || isClosing || docHook.loading;

  const shell = (
    <div
      ref={setRootNode}
      className={`vault-app ${isClosing ? "vault-app--closing" : ""}`}
    >
      <VaultHeader
        vault={vault}
        activePath={activeDoc?.path ?? null}
        saveStatus={saveStatus}
        saveError={saveError}
        recoveryCount={recoveryCount}
        navigatorCollapsed={navigatorCollapsed}
        onToggleNavigator={handleToggleNavigator}
        onOpenConflict={() => setShowConflictDialog(true)}
        onOpenRecovery={() => setShowRecoveryDialog(true)}
        onSave={handleExplicitSave}
        onToggleHistory={toggleHistory}
        onRetryWritable={
          repository.retryVault ? handleRetryWritable : undefined
        }
      />

      <div className="vault-main">
        {activityBarOn && (
          <ActivityBar
            run={runCommand}
            isAvailable={isCommandAvailable}
            hasHandler={hasCommandHandler}
            drawingOpen={activeDoc != null}
            writable={!vault?.readOnly}
            order={activityBarOrder}
            hidden={activityBarHidden}
            win={win}
          />
        )}
        <div className="vault-editor-pane">
          {tabs.showStrip && tabs.stripProps && (
            <TabStrip
              {...tabs.stripProps}
              activeStatus={saveStatus === "saving" ? "dirty" : saveStatus}
            />
          )}
          <div
            className={`vault-editor-body ${
              mainCovered ? "vault-editor-body--covered" : ""
            }`}
          >
            {visibleProblem && (
              <Banner
                kind="warning"
                className="vault-settings-alert"
                testId="settings-problem-banner"
                message={visibleProblem}
                onDismiss={() => setDismissedProblem(problemText)}
                dismissLabel="Dismiss settings problem"
              />
            )}
            {globalAlert && (
              <Banner
                kind={globalAlert.type}
                message={globalAlert.message}
                onDismiss={() => setGlobalAlert(null)}
                dismissLabel="Dismiss alert"
              />
            )}
            {activeDoc ? (
              <div
                // Loading blocks the pointer here (CSS), never through
                // readOnly/disabled: those switch Excalidraw to view mode and
                // hide its toolbar. Keys still reach the open drawing, which
                // the document hook flushes again before it is replaced.
                inert={mainCovered}
                className={`vault-editor-container ${
                  vault.readOnly ? "vault-editor-container--readonly" : ""
                } ${editorLoading ? "vault-editor-container--busy" : ""}`}
              >
                <EditorComponent
                  key={vault.handle}
                  documentId={activeDoc.id}
                  initialSource={activeDoc.source}
                  name={getBaseName(activeDoc.path)}
                  onChange={changeDoc}
                  onExport={exportEditorFile}
                  loading={editorLoading}
                  readOnly={vault.readOnly || isClosing || mainCovered}
                  disabled={isClosing || mainCovered}
                  theme={appTheme}
                  onThemeChange={handleCanvasThemeChange}
                  onOpenSettings={openSettings}
                  onOpenGraph={openGraph}
                  onToggleHistory={toggleHistory}
                  focusRequest={
                    focusRequest?.path === activeDoc.path ? focusRequest : null
                  }
                  library={libraryBundle}
                  links={editorLinks}
                  pdfImport={pdfControls}
                  onImportFile={importFile}
                  restore={editorRestore}
                />
              </div>
            ) : (
              <ActiveTabGate {...tabs.gateProps}>
                <VaultHome
                  readOnly={vault.readOnly}
                  recent={recentDrawings.map((entry) => ({
                    path: entry.path,
                    name: getBaseName(entry.path).replace(/\.excalidraw$/i, ""),
                    folder: getParentPath(entry.path) || vault.name,
                  }))}
                  onRun={(id) => commandRunner.run(id)}
                  onOpenDrawing={(path) => void handleOpenDrawing(path)}
                  ownerWindow={win}
                  inert={mainCovered}
                />
              </ActiveTabGate>
            )}
            <GalleryHost
              handle={vault.handle}
              vaultName={vault.name}
              directoryMap={directoryMap}
              loadDirectory={loadDirectory}
              sort={navigatorSort}
              templatesFolder={templatesFolder}
              activePath={activeDoc?.path ?? null}
              onOpenDrawing={handleOpenDrawing}
              onOpenChange={handleGalleryOpenChange}
              onClosed={focusCanvas}
            />
            <GraphHost
              handle={vault.handle}
              currentPath={activeDoc?.path ?? null}
              themeKey={appearance.snapshot.key}
              shortcutFor={graphShortcutFor}
              onOpenDrawing={(path, opts) =>
                path === activeDoc?.path && !opts
                  ? undefined
                  : handleOpenDrawing(path, opts)
              }
              onOpenChange={handleGraphOpenChange}
              onClosed={focusCanvas}
              {...graph}
            />
          </div>
        </div>

        <HistoryHost
          repository={history}
          vault={vault}
          settings={historySettings}
          document={activeDoc}
          flush={flushHistory}
          ownerDocument={doc}
          status={saveStatus}
          onOpenDrawing={openFromHistory}
          theme={appTheme}
          onSaveFile={exportEditorFile}
        />
        <PluginPanels />
        {templates.dialogs}
        {appLinks.dialogs}
        {appTags.dialog}
        <VaultNavigator
          vault={vault}
          activePath={activeDoc?.path ?? null}
          collapsed={navigatorCollapsed}
          onToggleCollapse={handleToggleNavigator}
          onOpenSettings={() => openSettings()}
          onOpenGraph={activityBarOn ? undefined : openGraph}
          graphOpen={graphOpen}
          onOpenLocalGraph={openLocalGraph}
          onShowHistory={showHistory}
          onOpenDrawing={handleOpenDrawing}
          search={vaultSearch}
          onOpenSearchResult={handleOpenSearchResult}
          searchFocusNonce={searchFocusNonce}
          request={navigatorRequest}
          onCreateDrawing={handleCreateDrawing}
          onCreateFolder={handleCreateFolder}
          onRenameEntry={handleRenameEntry}
          onMoveEntry={handleMoveEntry}
          onDuplicateDrawing={handleDuplicateDrawing}
          onSaveAsTemplate={templates.requestSave}
          onTrashEntry={handleTrashEntry}
          onRevealEntry={handleRevealEntry}
          onExportDrawing={handleExportDrawing}
          onSwitchVault={handleSwitchVault}
          sortOrder={navigatorSort}
          onSortChange={handleSortChange}
          confirmDelete={confirmDelete}
          showTagChips={showTagChips}
          tagsDefaultSort={tagsSettings.paneSort}
          onRenameTag={vaultTagRename ? appTags.renameTag : undefined}
          treeNodes={treeNodes}
          expandedFolders={expandedFolders}
          onToggleFolder={handleToggleFolder}
          onExpandFolder={handleExpandFolder}
          allIndexedEntries={allIndexedEntries}
          isIndexing={isIndexing}
          ownerDocument={doc}
          dockSlot={
            vaultLinks && appLinks.dockVisible ? (
              <Suspense fallback={null}>
                <LinksDock
                  ref={appLinks.dockRef}
                  links={vaultLinks}
                  handle={vault.handle}
                  path={activeDoc?.path ?? null}
                  refreshKey={appLinks.refreshKey}
                  onOpen={(path, elementId) =>
                    void appLinks.openLink(path, elementId)
                  }
                  onCreate={(target) => void appLinks.createTarget(target)}
                  visible={!navigatorCollapsed}
                />
              </Suspense>
            ) : null
          }
        />
      </div>

      {showConflictDialog && activeDoc && (
        <ConflictDialog
          currentPath={activeDoc.path}
          errorMessage={saveError}
          onReload={handleReloadConflict}
          onSaveCopy={handleSaveConflictCopy}
          onClose={() => setShowConflictDialog(false)}
        />
      )}

      {showRecoveryDialog && (
        <RecoveryDialog
          handle={vault.handle}
          repository={repository}
          onOpenRecovered={handleOpenRecovered}
          onClose={() => setShowRecoveryDialog(false)}
        />
      )}

      {showSettingsModal && (
        <Suspense fallback={null}>
          <SettingsModal
            vault={vault}
            initialPage={settingsPage}
            onClose={() => setShowSettingsModal(false)}
            onAppearanceChanged={refreshAppearance}
            pickDrawing={
              vaultLinks ? () => palettePick.pickDrawing() : undefined
            }
            themeRegistry={appearance.registry}
            onRevealVault={(path) => {
              void handleRevealEntry(path);
            }}
            onRevealRecovery={() => void handleRevealRecovery()}
            ownerDocument={doc}
          />
        </Suspense>
      )}

      {(switcher || palettePick.pick) && (
        <QuickSwitcher
          key={palettePick.pick ? "pick" : "palette"}
          search={vaultSearch}
          handle={vault.handle}
          fallbackPaths={drawingPaths()}
          initialMode={palettePick.pick ? "files" : switcher ?? "files"}
          pickLabel={palettePick.pick?.label}
          collectItems={collectPaletteItems}
          platform={commandRunner.platform}
          onOpenDrawing={(path, opts) => {
            if (palettePick.pick) {
              palettePick.finish(path);
              return;
            }
            setSwitcher(null);
            // Enter: current tab (new after file.openInNewTab); Mod+Enter: new.
            void handleOpenDrawing(path, {
              target:
                opts?.target ?? (switcherNewTab.current ? "new" : "current"),
            });
          }}
          onCreateDrawing={
            vault.readOnly
              ? undefined
              : (name) => {
                  setSwitcher(null);
                  void (async () => {
                    const parent = await prepareNewDrawingParent();
                    if (parent !== null) {
                      await handleCreateDrawing(parent, `${name}.excalidraw`);
                    }
                  })();
                }
          }
          onRunItem={runPaletteItem}
          onClose={() => {
            if (palettePick.pick) {
              palettePick.finish(null);
            }
            closeSwitcher();
          }}
          ownerDocument={doc}
        />
      )}

      {pdfImport.dialog}

      {showCloseDiscardConfirm && (
        <ConfirmModal
          title="Unsaved Changes"
          message="Vaultdraw could not save your latest changes to disk. If you close the window now, those changes are lost."
          confirmLabel="Discard and Close"
          cancelLabel="Keep Window Open"
          isDanger
          onConfirm={async () => {
            closeAttemptRef.current = true;
            setShowCloseDiscardConfirm(false);
            try {
              if (appWinRef.current) {
                await appWinRef.current.destroy();
              }
            } catch (err) {
              setGlobalAlert({
                message: `Could not close window: ${errorMessage(err)}`,
                type: "error",
              });
              setShowCloseDiscardConfirm(true);
            }
          }}
          onCancel={() => {
            setShowCloseDiscardConfirm(false);
            closeAttemptRef.current = false;
            setIsClosing(false);
          }}
        />
      )}

      <Toasts />
    </div>
  );
  return withThumbnails(shell);
};

export default VaultApp;
