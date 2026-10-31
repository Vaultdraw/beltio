import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { writeNewDrawing } from "./vault/writeNewDrawing";
import { fileKind, drawingStem } from "./vault/fileKind";

import { errorMessage, isNotFoundError } from "./vault/types";
import { uniqueName } from "./vault/uniqueName";
import { cachedPreferences } from "./vault/useGlobalPref";
import {
  desktopRepository,
  isTauriAvailable,
} from "./vault/DesktopVaultRepository";
import { DesktopVaultSearch } from "./search/DesktopVaultSearch";
import { DesktopVaultLinks } from "./links/DesktopVaultLinks";
import { useLinkDisplayPrefs } from "./links/useLinkDisplayPrefs";
import { useSpeculativeOpen } from "./speculative/useSpeculativeOpen";
import { useAutoReload } from "./watch/useAutoReload";
import { resolveOpenTarget } from "./control/openTarget";
import { createAppFiles } from "./control/appFiles";
import { waitForEditor } from "./control/editorReady";
import { createBusyCounter } from "./control/busyCounter";
import { openVaultAtPath } from "./control/vaultOpen";
import { canAddVaultLibrary, importLibrary } from "./control/libraryImport";
import { probeExists } from "./tabs/missingWatcher";
import { getCommand, isBuiltinCommand } from "./commands/commands";
import { isLinkCommand } from "./commands/linkCommands";
import { LinkPromptHost, LinkRequestHost } from "./control/linkRequests";
import { useControlBridge } from "./control/useControlBridge";
import { useMenuCommands } from "./help/useMenuCommands";
import { drawingNames, useAppLinks } from "./links/useAppLinks";
import { useLazyServices, useStartMode } from "./services/useLazyServices";
import { useServiceStart } from "./services/useServiceStart";
import { OnMount } from "./services/OnMount";
import { waitForInputQuiet } from "./services/inputQuiet";
import { DesktopVaultTagRename } from "./tags/DesktopVaultTagRename";
import { scheduleIdle } from "./platform/idle";
import { useAppTags } from "./tags/useAppTags";
import { useExtensions } from "./extensionSwitches/useExtensions";
import { useNetworkMode } from "./network/useNetworkMode";
import { useSetupCommand } from "./onboarding/useSetupCommand";
import { useSetupVisible } from "./onboarding/useSetupVisible";
import { SafeStartBanner } from "./safeStart/SafeStartBanner";
import {
  listenSafeStartRequests,
  registerSafeStartCommands,
} from "./safeStart/commands";
import { usePalettePick } from "./palette/usePalettePick";
import {
  addRecentVault,
  getExpandedFolders,
  getLinksSettings,
  getTagsSettings,
  getLastVaultPath,
  getNavigatorCollapsed,
  getPreferences,
  getRecentVaults,
  removeRecentVault,
  setExpandedFolders as saveExpandedFolders,
  setNavigatorCollapsed as saveNavigatorCollapsed,
  updatePreferences,
} from "./vault/preferences";
import {
  getImportDrawingLook,
  getNewDrawingPaper,
} from "./vault/newDrawingPaper";
import { isPageCommandChecked } from "./page/pageStatus";
import {
  getSettingsStatus,
  isConfigFolderActive,
  isWarning,
  PREFERENCES_CHANGED_EVENT,
  SETTINGS_STATUS_EVENT,
  type SettingsProblem,
  type SettingsStatus,
} from "./vault/settingsSync";
import {
  buildTree,
  createProgressThrottle,
  drawingCopyName,
  duplicateName,
  getBaseName,
  getParentPath,
  joinPath,
  rebaseFolderPath,
  scanVaultMetadata,
} from "./vault/treeStore";
import { applyParentListing } from "./vault/applyParentListing";
import { appEvents } from "./events/appEvents";
import { cancelImports } from "./plugins/importerMap";
import {
  isPluginVisiblePath,
  setWorkspaceBridge,
} from "./plugins/workspaceBridge";
import { useVaultDocument } from "./vault/useVaultDocument";
import { watchFallbackMessage } from "./vault/watchFallbackNotice";
import { useAppearance } from "./vault/useAppearance";
import { useSnippets } from "./snippets/useSnippets";
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
import { FocusChip } from "./layout/FocusChip";
import { LAYOUT_COMMAND_IDS } from "./layout/layoutCommands";
import { useActivityBarShown } from "./activityBar/activityBarRegistry";
import { getRegisteredHandler } from "./commands/handlerRegistry";
import { closeInstallDialog } from "./theme/install/installStore";
import { useThemeInstall } from "./theme/install/useThemeInstall";
import { TabStrip } from "./tabs/TabStrip";
import { useLayout, type Layout } from "./layout/useLayout";
import { useUserCommands } from "./commands/useUserCommands";
import { useVaultThemeCommands } from "./theme/useVaultThemeCommands";
import { useVaultAppearance } from "./theme/useVaultAppearance";
import { registerBisectCommands } from "./extensionSwitches/bisectCommands";
import { BisectBanner } from "./extensionSwitches/BisectBanner";
import { listNotePaths } from "./notes/noteScan";
import { applyNoteOps, notesOpsFor } from "./notes/noteListSync";

import {
  describeNotes,
  flushOpenNotes,
  NotesUnsavedError,
  unsavedNotePaths,
} from "./notes/openNotes";
import { isNotePath } from "./notes/register";
import { useNotes } from "./notes/useNotes";
import { ActiveTabGate } from "./tabs/ActiveTabGate";
import "./tabs/editorBody.css";
import { ancestorFolders } from "./tabs/revealPath";
import { useTabs } from "./tabs/useTabs";
import { appCommandHandlers } from "./commands/useAppCommands";
import {
  useCommandDispatcher,
  type CommandRunner,
} from "./commands/useCommands";
import { WhichKeyHost } from "./keys/WhichKeyHost";
import { drawingOpenCommandId } from "./commands/drawingCommands";
import { detectPlatform, formatChordWords } from "./commands/keys";
import { fileManagerWord } from "./platform/platformWords";
import { commandShortcutLabel } from "./palette/shortcuts";
import {
  collectPaletteItems,
  registerPaletteProvider,
} from "./palette/registry";
import { focusCanvasIfIdle } from "./palette/focus";
import { createCommandsProvider } from "./palette/providers/commands";
import { createThemesProvider } from "./palette/providers/themes";
import { resolveSelectedTheme } from "./theme/registry";
import {
  getOverlay,
  hasOverlay,
  hasCoveringOverlay,
  yieldOverlay,
  subscribeOverlay,
} from "./plugins/overlayStore";
import { FolderProvider } from "./plugins/folderContext";
import { useGraphEntry } from "./commands/useGraphEntry";
import { createDesktopThumbnailStore } from "./thumbnails/desktopStore";
import { ThumbnailsRoot } from "./thumbnails/ThumbnailsRoot";
import { HistoryHost } from "./history/HistoryHost";
import { runBackup, runRestore } from "./backup/backupJob";
import { setAppCommandRunner } from "./commands/appRunner";
import { flushPluginData, pluginHostStarted } from "./plugins/hostFlag";
import { runQuitBarrier } from "./quitBarrier";
import { usePluginSettingProblems } from "./plugins/settings/usePluginSettingProblems";
import { useHistoryEntry } from "./history/useHistoryEntry";
import { desktopHistoryRepository } from "./history/DesktopHistoryRepository";
import { useImportUpgrade } from "./importUpgrade/useImportUpgrade";
import { toHistorySettings } from "./history/historySettings";
import { LibraryStore } from "./library/libraryStore";
import { desktopLibraryRepository } from "./library/DesktopLibraryRepository";
import VaultEditor from "./editor/VaultEditor";
import { allEditorApis, getEditorApi } from "./editor/editorApi";
import { useCanvasImport } from "./canvasImport/useCanvasImport";

import { OfflineBadge } from "./components/OfflineBadge";
import { WindowControls } from "./components/WindowControls";
import { isCustomChrome } from "./vault/windowChrome";
import { VaultHeader } from "./components/VaultHeader";
import {
  VaultNavigator,
  type NavigatorAction,
  type NavigatorRequest,
} from "./components/VaultNavigator";
import { useNavigatorOverlay } from "./layout/useNavigatorOverlay";
import { useExplorerExport } from "./export/useExplorerExport";
import { Onboarding } from "./components/Onboarding";
import { ConflictDialog } from "./components/ConflictDialog";
import { RecoveryDialog } from "./components/RecoveryDialog";

import { QuickSwitcher } from "./components/QuickSwitcher";
import { Banner } from "./components/Banner";
import { Toasts } from "./components/Toasts";
import { toastStore } from "./toasts/toastStore";
import { useSyncConflicts } from "./sync/useSyncConflicts";
import { describeReadOnly } from "./vault/readOnlyReason";
import { AiHost } from "./ai/AiHost";
import { WatchdogHost } from "./watchdog/WatchdogHost";
import { ConfigResetConfirm } from "./components/ConfigResetConfirm";
import { ProfileDialogHost } from "./components/ProfileDialogHost";
import { ReportDialogHost } from "./components/ReportDialogHost";
import { ConfirmModal } from "./components/ConfirmModal";
import { VaultHome } from "./components/VaultHome";
import { DeferredHome } from "./components/DeferredHome";

import "./components/VaultShell.css";
import "./components/shell.css";

import type { NoteListOp } from "./notes/noteListSync";

import type { OpenTarget } from "./tabs/types";
import type { TabsApi } from "./tabs/useTabs";
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

// Plugin panel host: its chunk loads only after the host starts.
const PluginPanels = lazy(() =>
  import("./plugins/host/PluginPanels").then((m) => ({
    default: m.PluginPanels,
  })),
);
const PluginOverlayHost = lazy(() => import("./plugins/PluginOverlayHost"));
const PluginStatusBar = lazy(() =>
  import("./plugins/host/PluginPanels").then((m) => ({
    default: m.PluginStatusBar,
  })),
);
// The dock loads on demand: nothing about links is in the startup bundle.
const LinksDock = lazy(() =>
  import("./components/links/LinksDock").then((m) => ({
    default: m.LinksDock,
  })),
);

// The first-run setup (also "Run setup again"): a lazy chunk, fetched only when it shows.
const SetupWizard = lazy(() => import("./onboarding/SetupWizard"));

// The theme install dialog loads only when a command, Settings or the
// "no longer built in" notice opens it.
const ThemeBrowserDialog = lazy(() =>
  import("./components/ThemeBrowserDialog").then((m) => ({
    default: m.ThemeBrowserDialog,
  })),
);
const ThemeInstallDialog = lazy(() =>
  import("./components/ThemeInstallDialog").then((m) => ({
    default: m.ThemeInstallDialog,
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
  scheduleIdle(globalThis, () => void loadSettingsModal().catch(() => {}), {
    timeout: 3000,
    fallbackMs: 1500,
  });
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
  // Built-in extensions (`[extensions]`, live). Off = not created: hooks below
  // get `enabled: false`, hosts are not mounted, commands lose their handler.
  const ext = useExtensions(win);
  /** Full-text search UI; off = name-only search in the file tree and palette. */
  const searchUi = ext.search ? vaultSearch : null;
  // Safe start: "Restart in safe start" / "Restart normally", and a second
  // `vaultdraw launch --safe` while this window runs.
  useEffect(() => registerSafeStartCommands(), []);
  // Offline mode command, and the quiet update check once per launch.
  useNetworkMode(win ?? window);
  useSetupCommand();
  // Extension bisect: Start, or the answers while one runs.
  useEffect(() => registerBisectCommands(win), [win]);
  useEffect(() => {
    if (!isTauriAvailable(win)) {
      return undefined;
    }
    let off: (() => void) | null = null;
    let disposed = false;
    void listenSafeStartRequests().then((unlisten) => {
      if (disposed) {
        unlisten();
      } else {
        off = unlisten;
      }
    });
    return () => {
      disposed = true;
      off?.();
    };
  }, [win]);
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
    () =>
      isTauriAvailable(win)
        ? createDesktopThumbnailStore({
            capMb: () => getPreferences(win).thumbnailCacheMb,
          })
        : null,
    [win],
  );
  const thumbStore = thumbnails === undefined ? defaultThumbs : thumbnails;
  const setRootNode = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      setMountedDocument(node.ownerDocument);
    }
  }, []);

  const [vault, setVault] = useState<VaultInfo | null>(initialVault);
  const vaultHandle = vault?.handle;
  useEffect(() => {
    if (vault) {
      appEvents.emit("vault.opened", { name: vault.name });
    }
    // once per opened vault handle, not per vault object identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultHandle]);
  // search.start / links.start (D8): native services start lazily.
  // Only services an enabled extension needs start by themselves (the native
  // side applies the same rule at vault open, services.rs `wanted_of`).
  const linksWanted = ext.links || ext.graph;
  const indexWanted = linksWanted || ext.search || ext.tags;
  useLazyServices(
    win,
    vault?.handle ?? null,
    indexWanted ? vaultSearch : null,
    linksWanted ? vaultLinks : null,
  );
  const [onboardingError, setOnboardingError] = useState<string | null>(null);
  const [loadingVault, setLoadingVault] = useState(false);
  const [dismissedMdBanner, setDismissedMdBanner] = useState<string | null>(
    null,
  );
  const [dismissedReadOnlyBanner, setDismissedReadOnlyBanner] = useState<
    string | null
  >(null);
  // Notices are toasts (one system, themed, auto-closing). One alert at a time:
  // a new one replaces the last, and null dismisses it.
  const alertToastId = useRef<number | undefined>(undefined);
  const setGlobalAlert = useCallback(
    (alert: { message: string; type: "error" | "info" } | null) => {
      if (alertToastId.current !== undefined) {
        toastStore.dismiss(alertToastId.current);
        alertToastId.current = undefined;
      }
      if (alert) {
        alertToastId.current = toastStore.push({
          message: alert.message,
          kind: alert.type,
        });
      }
    },
    [],
  );
  const [isBusy, setIsBusy] = useState(false);
  // Control calls share one counter, so overlapping calls keep the overlay.
  const controlBusy = useMemo(() => createBusyCounter(setIsBusy), []);
  const [isClosing, setIsClosing] = useState(false);
  const [showCloseDiscardConfirm, setShowCloseDiscardConfirm] = useState(false);
  const [showNoteSavePrompt, setShowNoteSavePrompt] = useState(false);
  /** What could not be saved at quit (named in the discard dialog). */
  const [unsavedWhat, setUnsavedWhat] = useState<string[]>([]);
  /** A vault switch waiting for the user's answer about unsaved notes. */
  const [switchNotes, setSwitchNotes] = useState<{
    paths: string[];
    answer: (a: "save" | "discard" | "cancel") => void;
  } | null>(null);

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
  // Created below (it needs the tab strip state); toggles reach it here.
  const layoutRef = useRef<Layout | null>(null);
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
  const themeInstallRequest = useThemeInstall();
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
  // Per-vault settings.toml overrides merged over config.toml (vault > global).
  const vaultSettings = useVaultSettings(win, vault);
  // Colour theme + mode: tokens, html.dark, canvas sync (see useAppearance);
  // the vault may override theme, mode and accent.
  const appearance = useAppearance(
    doc,
    win,
    useVaultAppearance(win, vault?.handle ?? null, vaultSettings),
  );
  useSnippets(doc, win);
  const { refresh: refreshAppearance } = appearance;
  const setupVisible = useSetupVisible(!!vault, win);
  const appTheme = appearance.snapshot.mode;
  // The thumbnail service lives in ThumbnailsRoot (see there); save notices
  // reach it through this ref.
  const thumbServiceRef = useRef<ThumbnailService | null>(null);
  useInterfaceZoom(win);
  useVaultThemeCommands(vaultSettings, (message) =>
    toastStore.push({ message }),
  );
  const { navigatorSort, newDrawingFolder, templatesFolder } =
    vaultSettings.effective;
  // One preferences read per render (localStorage parse + normalise).
  const prefsNow = getPreferences(win);
  const { confirmDelete, showTagChips } = prefsNow;
  // interface.notice_seconds: how long error notices stay (0 = until dismissed).
  const noticeSeconds = prefsNow.noticeSeconds;
  useEffect(() => {
    toastStore.setErrorMs(noticeSeconds * 1000);
  }, [noticeSeconds]);
  const {
    activityBar: activityBarOn,
    activityBarOrder,
    activityBarHidden,
  } = vaultSettings.effective;
  const activityBarShown = useActivityBarShown(
    activityBarOn,
    activityBarHidden,
  );

  const { setEffective: setEffectiveSetting } = vaultSettings;
  const handleCanvasThemeChange = useCallback(
    (newTheme: "light" | "dark" | "system") => {
      // Write where the value lives: this vault if it overrides the mode.
      setEffectiveSetting("theme", newTheme);
      refreshAppearance();
    },
    [refreshAppearance, setEffectiveSetting],
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
  // Settings and theme errors get their own persistent banner: unrelated
  // setGlobalAlert(null) calls must not hide a still-broken config. Warnings
  // (unknown keys) are a toast and stay listed in Settings > General.
  const [settingsProblems, setSettingsProblems] = useState<SettingsProblem[]>(
    () => getSettingsStatus().problems,
  );
  const [dismissedProblem, setDismissedProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!win) {
      return;
    }
    const showSettingsStatus = (settingsStatus: SettingsStatus) => {
      const next = settingsStatus.problems;
      setSettingsProblems((prev) =>
        prev.length === next.length &&
        prev.every((p, i) => p.message === next[i].message)
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

  const pluginSettingProblems = usePluginSettingProblems(win);
  const settingsErrors = [...settingsProblems, ...vaultSettings.problems]
    .filter((p) => !isWarning(p))
    .map((p) => p.message);
  const settingsWarnings = [...settingsProblems, ...vaultSettings.problems]
    .filter(isWarning)
    .map((p) => p.message);
  const warningsKey = settingsWarnings.join("\n");
  const toastedWarnings = useRef(new Set<string>());
  useEffect(() => {
    const fresh = warningsKey
      ? warningsKey.split("\n").filter((m) => !toastedWarnings.current.has(m))
      : [];
    if (fresh.length === 0) {
      return;
    }
    fresh.forEach((m) => toastedWarnings.current.add(m));
    toastStore.push({
      message:
        fresh.length === 1
          ? fresh[0]
          : `${fresh[0]} (and ${
              fresh.length - 1
            } more; see Settings > General)`,
    });
  }, [warningsKey]);
  // Linux: the native file watcher could not start for this vault (inotify limit), so it is polled; say so once.
  const toastedWatchFallback = useRef<Set<string>>(new Set());
  useEffect(() => {
    const fallback = vault?.watchFallback;
    if (!vault || !fallback || toastedWatchFallback.current.has(vault.handle)) {
      return;
    }
    toastedWatchFallback.current.add(vault.handle);
    toastStore.push({
      message: watchFallbackMessage(fallback),
      durationMs: 20_000,
    });
  }, [vault]);
  const allProblems = [
    ...settingsErrors,
    ...pluginSettingProblems,
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
  const libraryOn = ext.library;
  useEffect(() => {
    void libraryStore.setVault(
      libraryOn ? vault?.handle ?? null : null,
      vault?.readOnly ?? false,
    );
  }, [libraryStore, libraryOn, vault?.handle, vault?.readOnly]);

  // `[library] folders` / `default`, live with the config.
  const libraryFoldersKey = prefsNow.libraryFolders.join("\n");
  const libraryDefault = prefsNow.libraryDefault;
  useEffect(() => {
    void libraryStore.configure(
      libraryFoldersKey ? libraryFoldersKey.split("\n") : [],
      libraryDefault,
    );
  }, [libraryStore, libraryFoldersKey, libraryDefault]);

  const vaultRef = useRef<VaultInfo | null>(vault);
  vaultRef.current = vault;
  const vaultGeneration = useRef(0);
  const directoryMapRef = useRef(directoryMap);
  directoryMapRef.current = directoryMap;
  const indexTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appWinRef = useRef<any>(null);
  const closePromiseRef = useRef<Promise<void> | null>(null);
  const closeAttemptRef = useRef(false);
  const notesDecisionRef = useRef<"save" | "discard" | null>(null);
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
    // Renamed or moved outside while open: the tab, favourites and plugins follow (C-4).
    onOutsideRename: (from, to) => {
      appEvents.emit("drawing.renamed", { from, to });
      tabsRef.current?.renamed(from, to);
    },
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
    fileReadOnly: activeFileReadOnly,
  } = docHook;

  const docHookRef = useRef(docHook);
  docHookRef.current = docHook;
  const reloadDocRef = useRef(reloadDoc);
  reloadDocRef.current = reloadDoc;
  const historyRef = useRef(history);
  historyRef.current = history;
  useSpeculativeOpen(
    doc,
    prefsNow.filesSpeculativeOpen,
    repository,
    vault?.handle ?? null,
    activeDoc?.path ?? null,
  );
  useAutoReload(repository, vault?.handle ?? null, prefsNow.filesAutoReload);
  useImportUpgrade({
    win,
    vault,
    repository,
    history,
    activeDoc,
    flush: flushDoc,
    reload: reloadDoc,
  });
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
        await runQuitBarrier(
          {
            prepareLeave: () => tabsRef.current?.prepareLeave(),
            flushDrawing: () => docHookRef.current.flush(),
            notesAutosaveOff: () => cachedPreferences().notesAutosaveMs === 0,
            unsavedNotePaths,
            describeNotes,
            flushOpenNotes,
            isNotesUnsavedError: (e) =>
              e instanceof NotesUnsavedError ? e.paths : null,
            flushLibrary: () => libraryStore.flush(),
            flushPluginData,
            destroyWindow: async () => {
              await appWinRef.current?.destroy();
            },
            askAboutNotes: () => {
              closeAttemptRef.current = false;
              setIsClosing(false);
              setShowNoteSavePrompt(true);
            },
            askAboutDiscard: (what) => {
              setUnsavedWhat(what);
              setShowCloseDiscardConfirm(true);
            },
            closed: () => setShowCloseDiscardConfirm(false),
          },
          notesDecisionRef,
        );
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
        // Not running inside a Tauri window (browser run): the same close step
        // answers a DOM event, which the browser tests dispatch.
        if (!disposed) {
          const onQuit = () => void flushAndDestroy();
          window.addEventListener("vaultdraw:quit-request", onQuit);
          unlistenQuit = () =>
            window.removeEventListener("vaultdraw:quit-request", onQuit);
        }
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
        message: `Couldn't save the drawing: ${errorMessage(err)}`,
        type: "error",
      });
    }
  }, [activeDoc, flushDoc, isBusy, isClosing, setGlobalAlert, vault?.readOnly]);

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

  // True when the parent's fresh listing no longer shows the folder (or the parent is gone too).
  const folderIsGone = useCallback(
    async (handle: string, dirPath: string) => {
      try {
        const siblings = await repository.listDirectory(
          handle,
          getParentPath(dirPath),
        );
        return !siblings.some((e) => e.path === dirPath);
      } catch (err) {
        return isNotFoundError(err);
      }
    },
    [repository],
  );

  // Load a directory's entries with generation check and error surfacing
  const loadDirectory = useCallback(
    async (dirPath: string, expectedGen?: number, soft = false) => {
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
          // Moved, renamed or deleted (here or outside the app): not an error. A soft
          // reload (after a rescan) drops the dead keys too, so the folder is not
          // listed again on every focus and a new folder with the old name does not
          // open expanded; but only once the parent's fresh listing no longer shows it
          // (an in-app move is still rebasing it until then).
          if (!soft || (await folderIsGone(vault.handle, dirPath))) {
            if (gen === vaultGeneration.current) {
              rebaseFolders(dirPath, null);
            }
          }
          return;
        }
        setGlobalAlert({
          message: `Couldn't read the folder "${
            dirPath || "vault root"
          }": ${errorMessage(err)}`,
          type: "error",
        });
      }
    },
    [repository, vault, rebaseFolders, folderIsGone, setGlobalAlert],
  );

  // files.list_start: the vault whose file list walk has started. Until then
  // the walk (scanVaultMetadata) and its watcher rescans are skipped; the
  // tree itself loads folder by folder either way.
  const listStartedFor = useRef<string | null>(null);
  // The open vault's walk context (cancellation + generation), for a start
  // that comes after vault open (idle or first use).
  const scanContext = useRef<{ signal: AbortSignal; gen: number } | null>(null);
  // The vault whose file list has been walked completely at least once, and
  // the callers waiting for it (link writers: see whenFileList).
  const listCompleteRef = useRef<string | null>(null);
  const [listCompleteFor, setListCompleteFor] = useState<string | null>(null);
  const listWaiters = useRef<((entries: readonly VaultEntry[]) => void)[]>([]);
  const entriesRef = useRef<readonly VaultEntry[]>(allIndexedEntries);
  entriesRef.current = allIndexedEntries;

  // Background indexing with cancellation and generation guard. Every call
  // (vault open, or a refresh after a change made in the app) counts as a
  // start of the file list.
  const startIndexing = useCallback(
    (signal?: AbortSignal, expectedGen?: number) => {
      if (!vault) {
        return;
      }
      const handle = vault.handle;
      listStartedFor.current = handle;
      const gen = expectedGen ?? vaultGeneration.current;
      setIsIndexing(true);
      const isCurrent = () =>
        gen === vaultGeneration.current && !signal?.aborted;
      // Partial snapshots only until this vault's first complete list: a
      // rescan keeps the complete list until its own result replaces it, so
      // link names never come from a half-walked vault.
      const throttle = createProgressThrottle((snapshot) => {
        if (isCurrent() && listCompleteRef.current !== handle) {
          setAllIndexedEntries(snapshot);
        }
      });
      scanVaultMetadata(
        repository,
        vault.handle,
        signal,
        (progress) => throttle.push(progress),
        () => waitForInputQuiet(win ?? window),
      )
        .then((finalList) => {
          throttle.cancel();
          if (isCurrent()) {
            setAllIndexedEntries(finalList);
            entriesRef.current = finalList;
            listCompleteRef.current = handle;
            setListCompleteFor(handle);
            const waiting = listWaiters.current;
            listWaiters.current = [];
            for (const w of waiting) {
              w(finalList);
            }
          }
          setIsIndexing(false);
        })
        .catch(() => {
          throttle.cancel();
          setIsIndexing(false);
        });
    },
    [repository, vault, win],
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

    // Background scan per files.list_start (started by useServiceStart
    // below; re-run here only when this vault's list already started), and
    // check recovery.
    scanContext.current = { signal: abortController.signal, gen: currentGen };
    if (listStartedFor.current === vault.handle) {
      startIndexing(abortController.signal, currentGen);
    }
    void refreshRecovery(currentGen);

    // Watcher subscription: handle late .then(off) cleanup
    let disposed = false;
    let unsubscribe: (() => void) | undefined;

    const scheduleCoalescedIndex = () => {
      if (indexTimeoutRef.current) {
        clearTimeout(indexTimeoutRef.current);
      }
      indexTimeoutRef.current = setTimeout(() => {
        if (
          !disposed &&
          currentGen === vaultGeneration.current &&
          listStartedFor.current === vault.handle
        ) {
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

        if (appEvents.hasListeners("vault.changed")) {
          // What plugins may see: drawings and folders, no dot segments.
          const paths = event.paths.filter(isPluginVisiblePath);
          if (paths.length > 0 || event.rescan) {
            appEvents.emit("vault.changed", { paths, rescan: !!event.rescan });
          }
        }

        if (event.rescan) {
          // Every folder the tree has loaded, not just the root: a rescan may stand for
          // changes anywhere (dropped events, odd names, a watcher restart).
          for (const dir of new Set(["", ...directoryMapRef.current.keys()])) {
            void loadDirectory(dir, currentGen, true);
          }
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
          let failure: unknown = null;
          for (const parent of parents) {
            let entries: VaultEntry[] | null;
            try {
              entries = await repository.listDirectory(vault.handle, parent);
            } catch (err) {
              // A child path of a folder removed outside the app: its folder is gone,
              // not an error (bug hunt BH-3). Other failures don't stop the rest.
              if (parent === "" || !isNotFoundError(err)) {
                failure ??= err;
                continue;
              }
              entries = null;
            }
            if (disposed || currentGen !== vaultGeneration.current) {
              return;
            }
            const listing = entries;
            setAllIndexedEntries((previous) =>
              applyParentListing(previous, parent, listing),
            );
          }
          if (failure !== null) {
            throw failure;
          }
        })().catch((err) => {
          if (!disposed && currentGen === vaultGeneration.current) {
            setGlobalAlert({
              message: `Couldn't update the search index: ${errorMessage(err)}`,
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
            message: `Couldn't watch the vault for outside changes: ${errorMessage(
              err,
            )}`,
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
  }, [
    loadDirectory,
    refreshRecovery,
    repository,
    setGlobalAlert,
    startIndexing,
    vault,
    win,
  ]);

  // files.list_start (declared after the vault effect, so "open" starts
  // with this vault's scan context in place).
  const fileListMode = useStartMode(win, "filesListStart");
  const fileList = useServiceStart(
    win,
    vault?.handle ?? null,
    fileListMode,
    (h) => {
      const ctx = scanContext.current;
      if (listStartedFor.current !== h && ctx) {
        startIndexing(ctx.signal, ctx.gen);
      }
    },
  );
  const needFileList = fileList.activate;
  const fileListReady = !!vault && listCompleteFor === vault.handle;
  /**
   * The vault's complete file list: at once when it has been walked, else
   * after starting the walk (files.list_start) and waiting for it. Link
   * writers use it so a link's short name never comes from a partial list.
   * A walk that never finishes (closed vault) gives the current list after
   * 15 s rather than hanging the action.
   */
  const whenFileList = useCallback((): Promise<readonly VaultEntry[]> => {
    const handle = vaultRef.current?.handle ?? null;
    if (handle !== null && listCompleteRef.current === handle) {
      return Promise.resolve(entriesRef.current);
    }
    needFileList();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        listWaiters.current = listWaiters.current.filter((w) => w !== done);
        resolve(entriesRef.current);
      }, 15_000);
      const done = (entries: readonly VaultEntry[]) => {
        clearTimeout(timer);
        resolve(entries);
      };
      listWaiters.current.push(done);
    });
  }, [needFileList]);
  // Opening the file switcher or palette is a use of the file list.
  useEffect(() => {
    if (switcher) {
      needFileList();
    }
  }, [switcher, needFileList]);

  // Safely switch vaults: flush and close old doc BEFORE releasing old vault handle
  // `sameVault`: swap the current vault's handle for a fresh one (Retry writable).
  const safelySwitchVault = async (chosen: VaultInfo, sameVault = false) => {
    if (!sameVault && vault && chosen.path === vault.path) {
      // Avoid choosing same old root and acquiring a duplicate/read-only clone. Release only the
      // extra handle: never the open vault's own (a repository that hands back the same handle
      // would otherwise close the vault in use).
      if (chosen.handle !== vault.handle) {
        await repository.releaseVault(chosen.handle);
      }
      return;
    }
    const oldVault = vault;
    try {
      // Close old doc first (flushes pending edits). Keep its generation valid
      // until that succeeds so a failed flush leaves the current vault usable.
      // Notes first, so a note that cannot be saved stops the switch before the drawing closes.
      let notesDecision: "save" | "discard" = "save";
      const unsaved = unsavedNotePaths();
      if (cachedPreferences().notesAutosaveMs === 0 && unsaved.length > 0) {
        const answer = await new Promise<"save" | "discard" | "cancel">(
          (answer) => setSwitchNotes({ paths: unsaved, answer }),
        );
        setSwitchNotes(null);
        if (answer === "cancel") {
          throw new Error("Vault not switched: your notes are unchanged.");
        }
        notesDecision = answer;
      }
      if (notesDecision === "save") {
        try {
          await flushOpenNotes();
        } catch (err) {
          const names =
            err instanceof NotesUnsavedError
              ? describeNotes(err.paths)
              : "a note";
          throw new Error(
            `Vault not switched: ${names} could not be saved (it may have changed on disk while you edited it). Open it to choose a version, then switch again.`,
          );
        }
      }
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
        message: `Couldn't reopen the vault: ${errorMessage(err)}`,
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
      setGlobalAlert({
        message: `Couldn't switch vault: ${msg}`,
        type: "error",
      });
    } finally {
      setIsBusy(false);
    }
  };

  // Toggle navigator collapse
  const handleToggleNavigator = () => {
    if (layoutRef.current?.toggleGoverned("navigator")) {
      return;
    }
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

  const reloadLoadedFolders = () => {
    for (const dir of new Set(["", ...directoryMapRef.current.keys()])) {
      void loadDirectory(dir, undefined, true);
    }
  };
  const refreshFiles = () => {
    reloadLoadedFolders();
    startIndexing();
    // The content index rescans too, so search catches what no event reported.
    if (vault && vaultSearch?.rescan) {
      void vaultSearch.rescan(vault.handle).catch(() => undefined);
    }
    void refreshRecovery();
  };
  // Coming back to the window (from a file manager, say) re-reads the listed folders: a
  // safety net behind the watcher, costing nothing until the window gains focus. With
  // files.auto_reload off, only Refresh updates.
  const reloadOnFocus = useRef(reloadLoadedFolders);
  reloadOnFocus.current = reloadLoadedFolders;
  const autoReload = prefsNow.filesAutoReload;
  const vaultHandleForFocus = vault?.handle ?? null;
  useEffect(() => {
    const target = win ?? window;
    if (!autoReload || !vaultHandleForFocus) {
      return;
    }
    let last = 0;
    const onFocus = () => {
      const now = Date.now();
      if (now - last < 2000) {
        return;
      }
      last = now;
      reloadOnFocus.current();
    };
    target.addEventListener("focus", onFocus);
    return () => target.removeEventListener("focus", onFocus);
  }, [autoReload, vaultHandleForFocus, win]);

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
          message: `Couldn't open the drawing: ${errorMessage(err)}`,
          type: "error",
        });
      }
      throw err;
    } finally {
      setIsBusy(false);
    }
  };
  // Tabs off: a note replaces the home pane (no tab strip to hold it).
  const [plainNote, setPlainNote] = useState<string | null>(null);
  const handleOpenDrawing = async (
    drawingPath: string,
    opts?: { target?: OpenTarget },
  ) => {
    if (tabs.enabled) {
      return tabs.open(drawingPath, opts?.target);
    }
    yieldOverlay(); // tabs off: no tab host does it
    try {
      await openWithFreeze(drawingPath);
      return true;
    } catch {
      return false;
    }
  };

  // Sync services: conflict copies (compare, keep one) and iCloud files not downloaded yet.
  const sync = useSyncConflicts({
    repository,
    history,
    vault,
    activePath: activeDoc?.path ?? null,
    theme: appTheme === "dark" ? "dark" : "light",
    openDrawing: (path) => handleOpenDrawing(path),
  });

  // Search result: open the drawing (unless active), then focus the element.
  const handleOpenSearchResult = async (
    drawingPath: string,
    match?: { elementId: string; containerId: string | null },
    opts?: { target?: OpenTarget },
  ) => {
    if (drawingPath !== activeDoc?.path) {
      await handleOpenDrawing(drawingPath, opts);
    } else {
      yieldOverlay(); // already open: a covering view still gives way
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
    const paper = getNewDrawingPaper(
      win,
      appTheme === "dark" ? "#121212" : "#ffffff",
    );
    const initialAppState = {
      theme: appTheme,
      ...paper,
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

  // Throws when the create fails: the New drawing dialog stays open and says why.
  const createDrawingOrThrow = async (parentPath: string, name: string) => {
    setIsBusy(true);
    setGlobalAlert(null);
    try {
      await createEntryCore(parentPath, name);
    } finally {
      setIsBusy(false);
    }
  };

  // Everywhere else (palette, plugins, empty state): a failure is a notice.
  const handleCreateDrawing = async (parentPath: string, name: string) => {
    try {
      await createDrawingOrThrow(parentPath, name);
    } catch (err) {
      setGlobalAlert({
        message: `Couldn't create "${name}": ${errorMessage(err)}`,
        type: "error",
      });
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
          message: `Couldn't create the default folder "${parent}": ${errorMessage(
            err,
          )}`,
          type: "error",
        });
        return null;
      }
    }
    return parent;
  };

  // The next free "<base>.excalidraw" / "<base> 1.excalidraw" in a folder.
  const freeDrawingName = async (parent: string, base: string) => {
    let taken: string[] = [];
    try {
      taken = (await repository.listDirectory(vault!.handle, parent)).map(
        (e) => e.name,
      );
    } catch {
      // folder not created yet: every name is free
    }
    return uniqueName(base, ".excalidraw", taken);
  };

  const handleNewDrawing = async () => {
    const parent = await prepareNewDrawingParent();
    if (parent !== null) {
      await handleCreateDrawing(
        parent,
        await freeDrawingName(parent, "Untitled"),
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
      await createEntryCore(
        parentPath,
        await freeDrawingName(parentPath, name.replace(/\.excalidraw$/, "")),
        json,
      );
    } finally {
      setIsBusy(false);
    }
  };

  const templates = useTemplates({
    enabled: ext.templates,
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
      prefsNow.linkCanvasIndicator,
    ],
  );
  const palettePick = usePalettePick();
  const appLinks = useAppLinks({
    enabled: ext.links,
    links: vaultLinks,
    search: vaultSearch,
    repository,
    vault,
    win,
    doc,
    settings: linksSettings,
    entries: allIndexedEntries,
    loadEntries: whenFileList,
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
    notify: (message, type) => setGlobalAlert({ message, type }),
  });
  const tagsSettings = useMemo(
    () => {
      const t = getTagsSettings(prefsNow);
      return ext.tags ? t : { ...t, autocomplete: false };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prefsNow.tagAutocomplete, prefsNow.tagPaneSort, ext.tags],
  );
  const appTags = useAppTags({
    enabled: ext.tags,
    api: vaultTagRename,
    links: vaultLinks,
    handle: vault?.handle ?? null,
    activePath: activeDoc?.path ?? null,
    bridge: appLinks.bridge,
    flushActive: () => flushDoc({ commitText: false }),
    notify: (message, type) => setGlobalAlert({ message, type }),
    doc,
  });
  const editorLinks = useMemo(
    () =>
      vaultLinks && (ext.links || ext.tags)
        ? {
            // Links off, Tags on: the wiring stays for `#` autocomplete only.
            settings: ext.links
              ? linksSettings
              : {
                  ...linksSettings,
                  autocomplete: false,
                  styleLinks: false,
                  hoverPreview: "off" as const,
                },
            tagsSettings,
            names: appLinks.names,
            onNeedNames: needFileList,
            namesReady: fileListReady,
            loadNames: () => whenFileList().then(drawingNames),
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
      ext.links,
      ext.tags,
      linksSettings,
      tagsSettings,
      appLinks.names,
      fileListReady,
      appLinks.editorCallbacks,
      activeDoc?.path,
      vault?.handle,
      palettePick.pickDrawing,
    ],
  );

  // Create folder
  // Throws when the create fails: the New folder dialog stays open and says why.
  const createFolderOrThrow = async (parentPath: string, name: string) => {
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
    appEvents.emit("drawing.renamed", { from: sourcePath, to: newPath });
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
        message: `Couldn't rename "${getBaseName(oldPath)}": ${errorMessage(
          err,
        )}`,
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
        message: `Couldn't move "${getBaseName(sourcePath)}": ${errorMessage(
          err,
        )}`,
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
      let target = drawingCopyName(path);
      const knownPaths = new Set(allIndexedEntries.map((e) => e.path));
      while (knownPaths.has(target)) {
        target = duplicateName(target);
      }
      const opId = `dup-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await writeNewDrawing(repository, {
        handle: vault.handle,
        path: target,
        json: file.json,
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
        message: `Couldn't duplicate "${getBaseName(path)}": ${errorMessage(
          err,
        )}`,
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
      appEvents.emit("drawing.deleted", { path });
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
        message: `Couldn't move "${getBaseName(
          path,
        )}" to the Trash: ${errorMessage(err)}`,
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
        message: `Couldn't show "${getBaseName(
          path,
        )}" in the file manager: ${errorMessage(err)}`,
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
        message: `Couldn't open the recovery folder: ${errorMessage(err)}`,
        type: "error",
      });
    }
  };

  /** Exports read disk: save pending edits when `path` is the open drawing. */
  // Reads the live document (not this render's snapshot): a tab may have
  // switched since. Background tabs hold no unsaved edits (a switch saves).
  const flushExportedDoc = async (path: string) => {
    const doc = docHookRef.current;
    if (doc.getActive()?.path === path) {
      try {
        await doc.flush({ commitText: false });
      } catch (err) {
        // A locked file cannot be saved: Save a copy writes the live scene instead.
        if (!doc.fileReadOnly) {
          throw err;
        }
      }
    }
  };

  const handleExportDrawing = useExplorerExport({
    repository,
    vault,
    win: win as (Window & typeof globalThis) | null,
    dark: appTheme === "dark",
    flushIfOpen: flushExportedDoc,
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
      await writeNewDrawing(repository, {
        handle: vault.handle,
        path: targetPath,
        json,
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
        message: `Couldn't open the recovered snapshot: ${errorMessage(err)}`,
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

  const openTagSearch = (query: string) => {
    showNavigator();
    requestNavigator({ kind: "search", query });
  };
  const showNavigator = () => {
    commitCanvasTextEdit(doc);
    layoutRef.current?.reveal("navigator");
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
    if (layoutRef.current?.toggleGoverned("activity_bar")) {
      return;
    }
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
  // The graph is the official graph plugin's overlay (plugins/official/graph).
  const pluginOverlayOpen = useSyncExternalStore(subscribeOverlay, hasOverlay);
  const graphOpen = useSyncExternalStore(
    subscribeOverlay,
    () => getOverlay()?.pluginId === "graph",
  );
  const mainCovered = useSyncExternalStore(
    subscribeOverlay,
    hasCoveringOverlay,
  );
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
    closeOverlays: () => yieldOverlay(),
    isStripShown: () => layoutRef.current?.shown.tab_strip ?? false,
    setShowStrip: (tabsShowStrip) => {
      if (!layoutRef.current?.toggleGoverned("tab_strip")) {
        updatePreferences({ tabsShowStrip }, win);
      }
    },
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

  // Markdown notes: a tab kind while `[extensions] notes` is on.
  useNotes();
  const needFileListRef = useRef(needFileList);
  needFileListRef.current = needFileList;
  const [noteList, setNoteList] = useState<{
    handle: string;
    paths: string[];
  } | null>(null);
  const noteScanAt = useRef(0);
  const scanOps = useRef<NoteListOp[] | null>(null);
  const scanNotes = useCallback(() => {
    const h = vault?.handle;
    if (!h || Date.now() - noteScanAt.current < 10_000) {
      return;
    }
    noteScanAt.current = Date.now();
    scanOps.current = [];
    void listNotePaths(repository, h).then((paths) => {
      // Changes that arrived while the walk ran may be missing from it.
      const ops = scanOps.current;
      scanOps.current = null;
      setNoteList({
        handle: h,
        paths: applyNoteOps(paths, ops ?? []),
      });
    });
  }, [vault?.handle, repository]);
  // Between full scans, create/rename/delete events update the list at once
  // (own actions and the file watcher alike). Nothing runs before a first scan.
  const noteListReady = noteList?.handle === vault?.handle && !!noteList;
  useEffect(() => {
    const h = vault?.handle;
    if (!h || !noteListReady) {
      return;
    }
    let off: (() => void) | undefined;
    let disposed = false;
    void repository
      .subscribe((event: VaultChange) => {
        if (event.handle !== h) {
          return;
        }
        void notesOpsFor(repository, h, event).then((ops) => {
          if (disposed || ops.length === 0) {
            return;
          }
          scanOps.current?.push(...ops);
          setNoteList((prev) => {
            if (!prev || prev.handle !== h) {
              return prev;
            }
            const paths = applyNoteOps(prev.paths, ops);
            return paths === prev.paths ? prev : { handle: h, paths };
          });
        });
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
  }, [vault?.handle, repository, noteListReady]);
  const kindVault = useMemo(
    () => ({
      handle: vault?.handle ?? null,
      ensurePaths: () => {
        needFileListRef.current();
        scanNotes();
      },
      paths: () => [
        ...allIndexedEntries
          .filter((e) => e.kind !== "folder")
          .map((e) => e.path),
        ...(noteList && noteList.handle === vault?.handle
          ? noteList.paths
          : []),
      ],
    }),
    [vault?.handle, allIndexedEntries, noteList, scanNotes],
  );
  tabsRef.current = tabs;
  useEffect(() => {
    if (activeDoc || tabs.enabled || !ext.notes) {
      setPlainNote(null);
    }
  }, [activeDoc, tabs.enabled, ext.notes]);
  const layout = useLayout(
    win,
    {
      navigator: !navigatorCollapsed,
      activity_bar: activityBarShown,
      tab_strip: tabs.showStrip,
      status_bar: true,
    },
    (message) => toastStore.push({ message }),
  );
  layoutRef.current = layout;
  const navigatorHidden = !layout.shown.navigator;
  // Narrow window: the file list is an overlay; Esc or opening a file closes it.
  const navigatorOverlay = layout.narrow && !navigatorHidden;
  // The document id, not the path: a rename keeps the id, so it does not count as opening a file.
  useNavigatorOverlay(
    doc,
    navigatorOverlay,
    handleToggleNavigator,
    activeDoc?.id ?? plainNote,
  );
  const editorRestore = useMemo(
    () =>
      activeDoc
        ? tabs.restoreFor(activeDoc.path, activeDoc.revision, activeDoc.id)
        : undefined,
    // The restore belongs to one mounted document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeDoc?.id, tabs.restoreFor],
  );
  const focusCanvas = useCallback(
    () =>
      doc
        ?.querySelector<HTMLElement>(".vault-editor .excalidraw-container")
        ?.focus({ preventScroll: true }),
    [doc],
  );

  const importFile = useCanvasImport({
    getApi: () => (activeDoc ? getEditorApi(activeDoc.id) : undefined),
    getDocument: () => doc ?? document,
    getPath: () => activeDoc?.path ?? null,
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
    newFromTemplate: ext.templates ? () => openTemplatePicker() : undefined,
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
    importFile: () => importFile(),
    cancelImport: () => {
      if (!cancelImports()) {
        toastStore.push({ message: "No import is running" });
      }
    },
    saveActiveAsTemplate: ext.templates
      ? () => {
          if (activeDoc) {
            templates.requestSave(activeDoc.path);
          }
        }
      : undefined,
    searchTags: ext.tags
      ? () => {
          showNavigator();
          requestNavigator({ kind: "search", query: tagQuery("") });
        }
      : undefined,
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
    backupVault:
      vault && isConfigFolderActive()
        ? () => void runBackup(vault.handle)
        : undefined,
    restoreBackup: isConfigFolderActive()
      ? () =>
          void runRestore(async (path) => {
            const chosen = await openVaultAtPath(path);
            try {
              await safelySwitchVault(chosen);
            } catch (err) {
              await repository.releaseVault(chosen.handle).catch(() => {});
              throw err;
            }
          })
      : undefined,
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
  useUserCommands(
    win,
    () => runnerRef.current,
    (message) => toastStore.push({ message }),
  );
  const pluginsStarted = useSyncExternalStore(
    pluginHostStarted.subscribe,
    pluginHostStarted.get,
  );
  useEffect(() => {
    setAppCommandRunner((id) => runnerRef.current?.run(id) ?? false);
    return () => setAppCommandRunner(null);
  }, []);
  useMenuCommands();
  const appFiles = createAppFiles({
    vault,
    repository,
    active: activeDoc
      ? {
          path: activeDoc.path,
          dirty: saveStatus !== "saved",
          conflict: saveStatus === "conflict",
        }
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
    editorReady: waitForEditor,
    createEntry: createEntryCore,
    moveEntry: (from, to, rewriteLinks) =>
      moveEntryCore(from, to, getParentPath(to), { rewriteLinks }),
    trashEntry: trashEntryCore,
    win: win as (Window & typeof globalThis) | null,
    flushIfOpen: flushExportedDoc,
    busy: controlBusy,
  });
  const appFilesRef = useRef(appFiles);
  appFilesRef.current = appFiles;
  // The shell pieces the plugin host's bridge reaches, read live (they are
  // re-created per render).
  const shellRef = useRef({
    vault,
    repository,
    prepareNewDrawingParent,
    createEntryCore,
    newDrawingAppState,
    loadDirectory,
    handleExpandFolder,
  });
  shellRef.current = {
    vault,
    repository,
    prepareNewDrawingParent,
    createEntryCore,
    newDrawingAppState,
    loadDirectory,
    handleExpandFolder,
  };
  useEffect(() => {
    setWorkspaceBridge({
      vault: () => {
        const f = appFilesRef.current.vault();
        return f ? { name: f.name, readOnly: f.readOnly } : null;
      },
      activePath: () => appFilesRef.current.active()?.path ?? null,
      openShortcut: (path) =>
        commandShortcutLabel(
          drawingOpenCommandId(path),
          getPreferences(win).hotkeys,
          detectPlatform(win),
          formatChordWords,
        ) || null,
      drawingExists: (path) => appFilesRef.current.drawingExists(path),
      openDrawing: (path, newTab) =>
        appFilesRef.current.openDrawing(path, newTab),
      newDrawingParent: () => shellRef.current.prepareNewDrawingParent(),
      importLook: () => getImportDrawingLook(win),
      newDrawingState: () => shellRef.current.newDrawingAppState(),
      createDrawing: (parent, name, json) =>
        shellRef.current.createEntryCore(parent, name, json),
      writeDrawing: async (path, json) => {
        const {
          vault: v,
          repository: repo,
          loadDirectory: load,
        } = shellRef.current;
        if (!v) {
          throw new Error("No vault is open");
        }
        const created = await writeNewDrawing(repo, {
          handle: v.handle,
          path,
          json,
          operationId: `pages-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2)}`,
        });
        await load(getParentPath(path));
        return created.revision;
      },
      replaceDrawing: async (path, json, opts) => {
        const {
          vault: v,
          repository: repo,
          loadDirectory: load,
        } = shellRef.current;
        if (!v) {
          throw new Error("No vault is open");
        }
        const { replaceDrawing } = await import("./vault/replaceDrawing");
        const doc = () => docHookRef.current;
        return replaceDrawing(
          {
            repository: repo,
            history: historyRef.current,
            handle: v.handle,
            flush: async (p) => {
              if (doc().getActive()?.path === p) {
                await doc().flush({ commitText: false });
              }
            },
            reload: async (p) => {
              if (doc().getActive()?.path === p) {
                await reloadDocRef.current();
              }
            },
            create: async (p, j) => {
              const made = await writeNewDrawing(repo, {
                handle: v.handle,
                path: p,
                json: j,
                operationId: `replace-${Date.now()}`,
              });
              await load(getParentPath(p));
              return made.revision;
            },
          },
          path,
          json,
          opts,
        );
      },
      trashDrawing: async (path, opts) => {
        const { vault: v, repository: repo } = shellRef.current;
        if (!v) {
          throw new Error("No vault is open");
        }
        const { trashDrawing } = await import("./vault/replaceDrawing");
        const doc = () => docHookRef.current;
        return trashDrawing(
          {
            repository: repo,
            history: historyRef.current,
            handle: v.handle,
            flush: async (p) => {
              if (doc().getActive()?.path === p) {
                await doc().flush({ commitText: false });
              }
            },
            trash: (p) => appFilesRef.current.trashEntry(p),
          },
          path,
          opts,
        );
      },
      flushDrawing: async (path) => {
        const doc = docHookRef.current;
        if (doc.getActive()?.path !== path) {
          return null;
        }
        await doc.flush({ commitText: false });
        return doc.getActive()?.revision ?? null;
      },
      drawingRevision: async (path) => {
        const { vault: v, repository: repo } = shellRef.current;
        if (!v) {
          return null;
        }
        try {
          return (await repo.readRevision?.(v.handle, path)) ?? null;
        } catch {
          return null;
        }
      },
      focusElement: (path, elementId) =>
        setFocusRequest({
          path,
          elementId,
          containerId: null,
          nonce: ++focusNonceRef.current,
        }),
      openVaultFolder: async (handle) => {
        // Lazy: the plugin host backend is not part of the startup graph.
        const { getPluginsBackend } = await import("./plugins/host/backend");
        const root = await getPluginsBackend().importTargetRoot(handle);
        await appFilesRef.current.openVault(root);
      },
      revealFolder: async (path) => {
        const { loadDirectory: load, handleExpandFolder: expand } =
          shellRef.current;
        // Every folder on the way is reloaded, the root too: a folder just created by an import
        // is not in the root listing the tree already holds.
        for (const folder of ["", ...ancestorFolders(path), path]) {
          await load(folder);
          if (folder !== "") {
            expand(folder);
          }
        }
      },
    });
    return () => setWorkspaceBridge(null);
  }, [win]);
  useControlBridge(win, {
    uri: {
      vault: () => (vault ? { name: vault.name, path: vault.path } : null),
      recentVaults: () => getRecentVaults(win),
      commandTitle: (id) => getCommand(id)?.title ?? null,
      isBuiltin: isBuiltinCommand,
      isLinkable: isLinkCommand,
      openSearch: openTagSearch,
      exists: (path) => probeExists(repository, vault?.handle ?? "", path),
      canAddVaultLibrary: () => canAddVaultLibrary(libraryStore),
      addLibrary: (json, scope) =>
        importLibrary(
          {
            store: libraryStore,
            apis: allEditorApis,
            parse: async (text) =>
              (await import("@excalidraw/excalidraw")).loadLibraryFromBlob(
                new Blob([text], { type: "application/json" }),
              ),
          },
          json,
          scope,
        ),
    },
    tabStore: tabs.store,
    activePath: activeDoc?.path ?? null,
    files: appFiles,
    runner: () => runnerRef.current ?? commandRunner,
    appState: () => ({
      activeDrawing: activeDoc
        ? { path: activeDoc.path, dirty: saveStatus !== "saved" }
        : null,
      tabs: tabs.store?.getState().tabs.length ?? (activeDoc ? 1 : 0),
    }),
    openTarget: async (target, cwd) => {
      // Before the file list is complete (files.list_start, or a walk in
      // progress) any drawing path is tried; opening reports a missing one.
      const listed =
        !!vault && listStartedFor.current === vault.handle && !isIndexing;
      if (!listed) {
        needFileList();
      }
      const path = vault
        ? resolveOpenTarget(target, cwd, vault.path, (p) =>
            listed
              ? allIndexedEntries.some(
                  (e) => e.kind === "drawing" && e.path === p,
                )
              : p.toLowerCase().endsWith(".excalidraw"),
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
    colorTheme: vaultSettings.effective.colorTheme,
    selectTheme: (_key: string): void => undefined,
  });
  paletteLive.current = {
    checked: (id) => {
      if (id.startsWith("appearance.mode.")) {
        return (
          vaultSettings.effective.theme === id.slice("appearance.mode.".length)
        );
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
    colorTheme: vaultSettings.effective.colorTheme,
    // Write where the value lives: this vault if it overrides the theme.
    selectTheme: (key) => {
      setEffectiveSetting("colorTheme", key);
      refreshAppearance();
    },
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
            resolveSelectedTheme(live().registry, live().colorTheme).entry.key,
          select: (key) => live().selectTheme(key),
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
  const vaultName = vault?.name ?? "";
  const homeRecent = useMemo(
    () =>
      recentDrawings.map((entry) => ({
        path: entry.path,
        name: drawingStem(getBaseName(entry.path)),
        folder: getParentPath(entry.path) || vaultName,
      })),
    [recentDrawings, vaultName],
  );
  // The vault whose home pane was released (DeferredHome unmounts while a
  // drawing is open; this keeps it from deferring again on close).
  const homeReleasedRef = useRef<string | null>(null);
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

  const handleSelectRecent = async (recentPath: string) => {
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
  };

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
        {setupVisible
          ? win && (
              <Suspense fallback={null}>
                <SetupWizard
                  win={win}
                  hasVault={false}
                  recentVaults={recentVaults}
                  lastVaultPath={lastVaultPath}
                  onOpenVault={handleOpenVault}
                  onCreateVault={handleCreateVault}
                  onSelectRecent={handleSelectRecent}
                  refreshAppearance={refreshAppearance}
                  error={onboardingError}
                  loading={loadingVault}
                />
              </Suspense>
            )
          : null}
        {setupVisible && themeInstallRequest?.mode === "browse" && (
          <Suspense fallback={null}>
            <ThemeBrowserDialog
              refresh={themeInstallRequest.refresh}
              onClose={closeInstallDialog}
              onThemeChanged={refreshAppearance}
            />
          </Suspense>
        )}
        {!setupVisible && (
          <Onboarding
            recentVaults={recentVaults}
            lastVaultPath={lastVaultPath}
            onOpenVault={handleOpenVault}
            onCreateVault={handleCreateVault}
            onSelectRecent={handleSelectRecent}
            onRemoveRecent={(p) => removeRecentVault(p, win)}
            error={onboardingError}
            loading={loadingVault}
            ownerWindow={win}
          />
        )}
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
      className={`vault-app ${isClosing ? "vault-app--closing" : ""} ${
        layout.shown.footer ? "" : "vault-app--no-footer"
      }`}
    >
      {/* A save problem keeps the header: it is where the user is told. */}
      {layout.shown.header ||
      !!saveError ||
      saveStatus === "conflict" ||
      saveStatus === "error" ? (
        <VaultHeader
          vault={vault}
          activePath={activeDoc?.path ?? null}
          saveStatus={saveStatus}
          saveError={saveError}
          recoveryCount={recoveryCount}
          navigatorCollapsed={navigatorHidden}
          onToggleNavigator={handleToggleNavigator}
          onOpenConflict={() => setShowConflictDialog(true)}
          onOpenRecovery={() => setShowRecoveryDialog(true)}
          onSave={handleExplicitSave}
          onToggleHistory={ext.history ? toggleHistory : undefined}
          onRetryWritable={
            repository.retryVault ? handleRetryWritable : undefined
          }
        />
      ) : (
        // Header hidden: on macOS a thin drag strip keeps the window buttons
        // off the canvas and the navigator; with Linux custom chrome it is the
        // title bar and carries the window buttons (hunter B-4).
        <div className="vault-titlebar-strip" data-tauri-drag-region>
          {/* Offline mode keeps an indicator with the header hidden (hunter B-4). */}
          <OfflineBadge />
          {isCustomChrome(win) && <WindowControls />}
        </div>
      )}

      <div className="vault-main">
        {layout.shown.activity_bar && (
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
          {layout.shown.tab_strip && tabs.stripProps && (
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
            <SafeStartBanner />
            <BisectBanner win={win} />
            {activeDoc &&
              fileKind(activeDoc.path) === "excalidrawMd" &&
              dismissedMdBanner !== activeDoc.path && (
                <Banner
                  kind="info"
                  testId="excalidraw-md-banner"
                  onDismiss={() => setDismissedMdBanner(activeDoc.path)}
                  dismissLabel="Dismiss notice"
                  message="Obsidian Excalidraw drawing: shown read-only so the plugin's file stays intact. Use Save a copy to edit it as a .excalidraw drawing."
                />
              )}
            {activeDoc &&
              activeFileReadOnly &&
              fileKind(activeDoc.path) !== "excalidrawMd" &&
              dismissedReadOnlyBanner !== activeDoc.path && (
                <Banner
                  kind="info"
                  testId="read-only-file-banner"
                  onDismiss={() => setDismissedReadOnlyBanner(activeDoc.path)}
                  dismissLabel="Dismiss notice"
                  message={`Read-only file: make it writable in ${fileManagerWord()}${
                    detectPlatform() === "mac"
                      ? " (Get Info → Sharing & Permissions)"
                      : ""
                  } to edit, or save a copy.`}
                  action={{
                    label: "Save a copy",
                    testId: "read-only-save-copy",
                    onClick: () =>
                      void handleExportDrawing(activeDoc.path, "copy"),
                  }}
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
                  vault.readOnly ||
                  activeFileReadOnly ||
                  fileKind(activeDoc.path) === "excalidrawMd"
                    ? "vault-editor-container--readonly"
                    : ""
                } ${editorLoading ? "vault-editor-container--busy" : ""}`}
              >
                <EditorComponent
                  key={vault.handle}
                  documentId={activeDoc.id}
                  path={activeDoc.path}
                  initialSource={activeDoc.source}
                  name={getBaseName(activeDoc.path)}
                  onChange={changeDoc}
                  onExport={exportEditorFile}
                  loading={editorLoading}
                  readOnly={
                    vault.readOnly ||
                    activeFileReadOnly ||
                    fileKind(activeDoc.path) === "excalidrawMd" ||
                    isClosing ||
                    mainCovered
                  }
                  documentReadOnly={
                    vault.readOnly ||
                    activeFileReadOnly ||
                    fileKind(activeDoc.path) === "excalidrawMd"
                  }
                  disabled={isClosing || mainCovered}
                  theme={appTheme}
                  onThemeChange={handleCanvasThemeChange}
                  onOpenSettings={openSettings}
                  onOpenGraph={ext.graph ? openGraph : undefined}
                  onToggleHistory={ext.history ? toggleHistory : undefined}
                  focusRequest={
                    focusRequest?.path === activeDoc.path ? focusRequest : null
                  }
                  library={libraryOn ? libraryBundle : undefined}
                  links={editorLinks}
                  onImportFile={importFile}
                  restore={editorRestore}
                />
              </div>
            ) : (
              <ActiveTabGate
                {...tabs.gateProps}
                kindVault={kindVault}
                onOpenSearch={openTagSearch}
                plainPath={tabs.enabled ? null : plainNote}
                onOpenPath={
                  tabs.enabled
                    ? tabs.gateProps?.onOpenPath
                    : (path, opts) => {
                        if (isNotePath(path)) {
                          yieldOverlay();
                          setPlainNote(path);
                        } else {
                          void handleOpenDrawing(path, opts);
                        }
                      }
                }
              >
                <DeferredHome
                  win={win ?? window}
                  vaultKey={vault.handle}
                  rootListed={directoryMap.has("")}
                  enabled={prefsNow.deferHomePane}
                  releasedRef={homeReleasedRef}
                >
                  {fileListMode === "use" && <OnMount run={needFileList} />}
                  <VaultHome
                    readOnly={vault.readOnly}
                    recent={homeRecent}
                    onRun={(id) => commandRunner.run(id)}
                    onOpenDrawing={(path) => void handleOpenDrawing(path)}
                    ownerWindow={win}
                    inert={mainCovered}
                  />
                </DeferredHome>
              </ActiveTabGate>
            )}
            {pluginOverlayOpen && (
              <Suspense fallback={null}>
                <FolderProvider
                  value={{
                    directoryMap,
                    loadDirectory,
                    sort: navigatorSort,
                    templatesFolder,
                  }}
                >
                  <PluginOverlayHost onClosed={focusCanvas} />
                </FolderProvider>
              </Suspense>
            )}
          </div>
        </div>

        <HistoryHost
          repository={history}
          vault={vault}
          settings={historySettings}
          document={activeDoc}
          flush={flushHistory}
          ownerDocument={doc}
          interfaceOn={ext.history}
          status={saveStatus}
          onOpenDrawing={openFromHistory}
          theme={appTheme}
          onSaveFile={exportEditorFile}
        />
        {pluginsStarted && (
          <Suspense fallback={null}>
            <PluginPanels narrow={layout.narrow} />
          </Suspense>
        )}
        {templates.dialogs}
        {appLinks.dialogs}
        {appTags.dialog}
        {navigatorOverlay && (
          <div
            className="vault-navigator-scrim"
            data-testid="navigator-scrim"
            onPointerDown={handleToggleNavigator}
          />
        )}
        <VaultNavigator
          // A new vault gets a fresh navigator (search text, focus, open dialogs), as Obsidian
          // opens a vault in a clean window (hunter C-7).
          key={vault.handle}
          vault={vault}
          activePath={activeDoc?.path ?? null}
          collapsed={navigatorHidden}
          overlay={layout.narrow}
          onToggleCollapse={handleToggleNavigator}
          onRefresh={refreshFiles}
          onOpenNote={(path, opts) => {
            if (ext.notes && tabs.enabled) {
              return tabs.open(path, opts?.target);
            }
            if (ext.notes) {
              // Tabs off: show the note in the main pane instead.
              yieldOverlay();
              void (activeDoc ? closeDoc() : Promise.resolve()).then(() =>
                setPlainNote(path),
              );
              return;
            }
            toastStore.push({
              message: "Markdown notes are turned off (Settings, Extensions).",
            });
          }}
          onOpenSettings={() => openSettings()}
          onOpenGraph={
            layout.shown.activity_bar || !ext.graph ? undefined : openGraph
          }
          graphOpen={graphOpen}
          onOpenLocalGraph={ext.graph ? openLocalGraph : undefined}
          onShowHistory={ext.history ? showHistory : undefined}
          onSyncAction={sync.onSyncAction}
          onOpenDrawing={handleOpenDrawing}
          search={searchUi}
          tagSearch={ext.tags ? vaultSearch ?? undefined : null}
          onOpenSearchResult={handleOpenSearchResult}
          searchFocusNonce={searchFocusNonce}
          request={navigatorRequest}
          onCreateDrawing={createDrawingOrThrow}
          onCreateFolder={createFolderOrThrow}
          onRenameEntry={handleRenameEntry}
          onMoveEntry={handleMoveEntry}
          onDuplicateDrawing={handleDuplicateDrawing}
          onSaveAsTemplate={ext.templates ? templates.requestSave : undefined}
          onTrashEntry={handleTrashEntry}
          onCountFolderItems={
            repository.countFolderItems && vault
              ? (path) => repository.countFolderItems!(vault.handle, path)
              : undefined
          }
          onRevealEntry={handleRevealEntry}
          onExportDrawing={handleExportDrawing}
          onSwitchVault={handleSwitchVault}
          sortOrder={navigatorSort}
          onSortChange={handleSortChange}
          confirmDelete={confirmDelete}
          showTagChips={showTagChips}
          tagsDefaultSort={tagsSettings.paneSort}
          onRenameTag={
            vaultTagRename && ext.tags ? appTags.renameTag : undefined
          }
          treeNodes={treeNodes}
          expandedFolders={expandedFolders}
          onToggleFolder={handleToggleFolder}
          onExpandFolder={handleExpandFolder}
          allIndexedEntries={allIndexedEntries}
          isIndexing={isIndexing}
          onNeedIndex={needFileList}
          ownerDocument={doc}
          dockSlot={
            vaultLinks && ext.links && appLinks.dockVisible ? (
              <Suspense fallback={null}>
                <LinksDock
                  ref={appLinks.dockRef}
                  links={vaultLinks}
                  handle={vault.handle}
                  path={activeDoc?.path ?? null}
                  refreshKey={appLinks.refreshKey}
                  tabRequest={appLinks.tabRequest}
                  onOpen={(path, elementId) =>
                    void appLinks.openLink(path, elementId)
                  }
                  onCreate={(target) => void appLinks.createTarget(target)}
                  visible={!navigatorHidden}
                />
              </Suspense>
            ) : null
          }
        />
      </div>
      {pluginsStarted && win && layout.shown.status_bar && (
        <Suspense fallback={null}>
          <PluginStatusBar win={win} />
        </Suspense>
      )}
      {layout.focusActive && prefsNow.focusHint && (
        <FocusChip
          win={win}
          onExit={() => void runCommand(LAYOUT_COMMAND_IDS.exitFocus)}
        />
      )}

      {sync.dialog}

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

      {setupVisible && win && (
        <Suspense fallback={null}>
          <SetupWizard
            win={win}
            hasVault
            recentVaults={recentVaults}
            lastVaultPath={lastVaultPath}
            onOpenVault={handleOpenVault}
            onCreateVault={handleCreateVault}
            onSelectRecent={handleSelectRecent}
            refreshAppearance={refreshAppearance}
            error={onboardingError}
            loading={loadingVault}
          />
        </Suspense>
      )}

      <WhichKeyHost win={win} />

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

      {/* After Settings: the warning must stack above it. */}
      <AiHost win={win} />
      <WatchdogHost win={win} />
      {themeInstallRequest && (
        <Suspense fallback={null}>
          {themeInstallRequest.mode === "browse" ? (
            <ThemeBrowserDialog
              refresh={themeInstallRequest.refresh}
              onClose={closeInstallDialog}
              onThemeChanged={refreshAppearance}
            />
          ) : (
            <ThemeInstallDialog
              request={themeInstallRequest}
              onClose={closeInstallDialog}
              onThemeChanged={refreshAppearance}
            />
          )}
        </Suspense>
      )}

      {(switcher || palettePick.pick) && (
        <QuickSwitcher
          key={palettePick.pick ? "pick" : "palette"}
          search={searchUi}
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

      {showNoteSavePrompt && (
        <ConfirmModal
          title="Unsaved notes"
          message={`${describeNotes(unsavedNotePaths())} ${
            unsavedNotePaths().length === 1 ? "has" : "have"
          } changes that are not saved. Autosave is off.`}
          confirmLabel="Save and Close"
          cancelLabel="Cancel"
          alternatives={[
            {
              label: "Don't Save",
              onChoose: () => {
                notesDecisionRef.current = "discard";
                setShowNoteSavePrompt(false);
                void flushAndDestroy();
              },
            },
          ]}
          onConfirm={() => {
            notesDecisionRef.current = "save";
            setShowNoteSavePrompt(false);
            void flushAndDestroy();
          }}
          onCancel={() => {
            void import("@tauri-apps/api/core")
              .then((m) => m.invoke("plugins_restart_cancel"))
              .catch(() => {});
            setShowNoteSavePrompt(false);
            notesDecisionRef.current = null;
          }}
        />
      )}

      {switchNotes && (
        <ConfirmModal
          title="Unsaved notes"
          message={`${describeNotes(switchNotes.paths)} ${
            switchNotes.paths.length === 1 ? "has" : "have"
          } changes that are not saved. Autosave is off.`}
          confirmLabel="Save and Switch"
          cancelLabel="Cancel"
          alternatives={[
            {
              label: "Don't Save",
              onChoose: () => switchNotes.answer("discard"),
            },
          ]}
          onConfirm={() => switchNotes.answer("save")}
          onCancel={() => switchNotes.answer("cancel")}
        />
      )}

      {showCloseDiscardConfirm && (
        <ConfirmModal
          title="Unsaved changes"
          message={`Vaultdraw could not save ${
            unsavedWhat.length > 0
              ? unsavedWhat.join(", ")
              : "your latest changes"
          } to disk. Everything else was saved. If you close the window now, ${
            unsavedWhat.length > 0 ? "these changes are" : "those changes are"
          } lost.`}
          confirmLabel="Discard and Close"
          cancelLabel="Keep Window Open"
          alternatives={
            activeDoc && activeFileReadOnly
              ? [
                  {
                    label: "Save a copy…",
                    onChoose: () =>
                      void handleExportDrawing(activeDoc.path, "copy"),
                  },
                ]
              : undefined
          }
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
                message: `Couldn't close the window: ${errorMessage(err)}`,
                type: "error",
              });
              setShowCloseDiscardConfirm(true);
            }
          }}
          onCancel={() => {
            // A pending plugin restart must not relaunch an app the user kept open.
            void import("@tauri-apps/api/core")
              .then((m) => m.invoke("plugins_restart_cancel"))
              .catch(() => {});
            setShowCloseDiscardConfirm(false);
            closeAttemptRef.current = false;
            setIsClosing(false);
          }}
        />
      )}

      <LinkRequestHost />
      <LinkPromptHost />
      <ConfigResetConfirm />
      <ReportDialogHost />
      <ProfileDialogHost />

      <Toasts />
    </div>
  );
  return withThumbnails(shell);
};

export default VaultApp;
