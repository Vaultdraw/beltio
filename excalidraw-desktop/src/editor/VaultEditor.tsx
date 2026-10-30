import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  CaptureUpdateAction,
  DefaultSidebar,
  Footer,
  Excalidraw,
  MainMenu,
} from "@excalidraw/excalidraw";
import {
  DEFAULT_SIDEBAR,
  viewportCoordsToSceneCoords,
} from "@excalidraw/common";

import {
  LoadIcon,
  saveAs,
  fullscreenIcon,
  settingsIcon,
} from "@excalidraw/excalidraw/components/icons";

import type {
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ImageExportRequest,
} from "@excalidraw/excalidraw/types";
import type { ExcalidrawImageElement } from "@excalidraw/element/types";
import type { HostContextMenuItem } from "@excalidraw/excalidraw/components/ContextMenu";

import { drawingStem } from "../vault/fileKind";

import { planImport, skippedMessage } from "../canvasImport/importFiles";
import { getAppCommandRunner } from "../commands/appRunner";
import { getRegisteredCommand, subscribeCommands } from "../commands/registry";
import {
  createsOwnDrawing,
  hasImporters,
  runImports,
} from "../plugins/importerMap";
import {
  OBSIDIAN_IMPORT_COMMAND_ID,
  PDF_IMPORT_COMMAND_ID,
} from "../plugins/officialPlugins";
import { useCanvasImportMenu } from "../canvasImport/useCanvasImportMenu";
import { getMenuItems, runMenuItem } from "../plugins/menuRegistry";
import {
  ACTION_KEYS_CONTEXT,
  bindActionCommands,
  HOST_ACTION_NAMES,
} from "../commands/actionCommands";
import { CommandMenuItem } from "../commands/CommandMenuItem";
import { GRAPH_COMMAND_IDS } from "../commands/graphCommands";
import { registerCommandHandlers } from "../commands/handlerRegistry";
import { defineContextKey } from "../commands/contextKeys";
import {
  createToolHandlers,
  TOOL_KEYS_CONTEXT,
} from "../commands/toolCommands";
import { IconGraph, IconHistory, IconLibrary } from "../components/Icons";
import { HISTORY_COMMAND_IDS } from "../history/historyCommands";
import { PaperDialog } from "../components/paper/PaperDialog";
import { PaperMenuItem } from "../components/paper/PaperMenuItem";
import { PageMenuItem } from "../components/page/PageMenuItem";
import { PageSetupDialog } from "../components/page/PageSetupDialog";
import { PageNotice } from "../page/PageNotice";
import { usePageMode } from "../page/usePageMode";
import { useVaultLibrary } from "../library/useVaultLibrary";
import { copyToClipboard } from "../vault/clipboard";
import { getPreferences, updatePreferences } from "../vault/preferences";

import { PenBar } from "../pens/PenBar";

import { PluginToolbar } from "../plugins/PluginToolbar";
import { usePluginOn } from "../plugins/usePluginOn";

import { usePens } from "../pens/usePens";
import {
  readDrawingMarkdown,
  readDrawingStyles,
} from "../toolDefaults/drawingStyles";
import { useMarkdownMode } from "../markdown/useMarkdownMode";
import { MarkdownChip } from "../markdown/MarkdownChip";
import { useToolDefaults } from "../toolDefaults/useToolDefaults";
import { editFormulaImage } from "../plugins/formulaEdit";
import { useMemoryRetention } from "../memory/useMemoryRetention";
import { markOpen } from "../perf/openMarks";

import "../theme/excalidrawChrome.css";

import { useLinkIndicator } from "./links/useLinkIndicator";

import "./compositing.css";

import { registerCanvasRepaint, suspendCanvasSync } from "./canvasSync";
import { registerEditorApi, registerLiveEditor } from "./editorApi";
import { registerEditorFlush } from "./editorFlush";
import { useEditorPalette } from "./useEditorPalette";
import { useVaultEditorLinks } from "./links/useVaultEditorLinks";
import { rememberExportOptions } from "./exportOptions";
import { focusElement } from "./focusElement";
import { PANNED_CLASS, watchFirstPan } from "./panHint";
import { renderImageExport } from "./imageExport";
import { onEditorPaste } from "./pastePlugins";
import { serializeSceneForSave } from "./sceneSerializer";
import { getSaveSignature } from "./saveSignature";
import { isSwapping, loadScene } from "./sceneSwap";
import { blockEditorKeys } from "./inputGuard";
import { LoadingLine } from "./LoadingLine";
import { useSceneSwap } from "./useSceneSwap";

import type { EditorLinksWiring } from "./links/useVaultEditorLinks";

import type { ScenePoint } from "../canvasImport/useCanvasImport";
import type { SettingsTarget } from "../components/settings/schema";
import type { LibraryStore } from "../library/libraryStore";
import type { LibraryRepository } from "../library/types";
import type { EditorRestore } from "../tabs/useTabs";

import type { FlushOptions } from "./editorFlush";

import type { ComponentProps, DragEvent } from "react";

type Props = {
  documentId: string;
  /** Vault-relative path of the shown drawing (read live; renames keep the document id). */
  path?: string | null;
  /** Stable per-activation handle; read when the scene loads, not on render. */
  initialSource: { readonly json: string };
  name: string;
  onChange: (json: string) => void;
  onExport?: (name: string, bytes: Uint8Array) => Promise<boolean>;
  readOnly?: boolean;
  /** The drawing cannot be written (vault/file read-only); unlike `readOnly` it ignores transient UI cover. */
  documentReadOnly?: boolean;
  disabled?: boolean;
  theme?: "light" | "dark";
  onThemeChange?: (theme: "light" | "dark" | "system") => void;
  /** Opens Settings, on `page` when given (the pen bar opens "tools:pen"). */
  onOpenSettings?: (page?: SettingsTarget) => void;
  /** Main menu "Graph view": runs graph.open. */
  onOpenGraph?: () => void;
  /** Main menu "History": runs history.toggle. */
  onToggleHistory?: () => void;
  /** Select + scroll to an element once the scene is loaded (search results). */
  focusRequest?: {
    elementId: string;
    containerId: string | null;
    nonce: number;
  } | null;
  /** Persisted library; omit to run with Excalidraw's in-memory library. */
  library?: { store: LibraryStore; repository: LibraryRepository };
  /** Links (open/insert/hints, rename edits, re-measure); omit for none. */
  links?: EditorLinksWiring;
  /** PDF import (menu item, dropped PDFs); omit for none. */
  /** Canvas right-click "Import file…" (PDF or images at that point). */
  onImportFile?: (at?: ScenePoint) => unknown;
  /** Tabs: view for the first paint and the undo stacks to bring back. */
  restore?: EditorRestore;
  /** The app is reading the next document: shows the progress line after a delay. */
  loading?: boolean;
};

type Snapshot = Parameters<
  NonNullable<ComponentProps<typeof Excalidraw>["onChange"]>
>;
const IDLE_SERIALIZE_MS = 600;
const MAX_SERIALIZE_MS = 2500;

/**
 * One editor instance serves every document of a vault: a new `documentId`
 * swaps the scene in place (see useSceneSwap), keeping the toolbar and the old
 * drawing on screen until the new one is ready. History and image files are
 * reset per document by the swap.
 */
const VaultEditorComponent = ({
  documentId,
  path = null,
  initialSource,
  name,
  onChange,
  onExport,
  readOnly = false,
  documentReadOnly,
  disabled = false,
  theme,
  onThemeChange,
  onOpenSettings,
  onOpenGraph,
  onToggleHistory,
  focusRequest = null,
  library,
  links,
  onImportFile,
  restore,
  loading = false,
}: Props) => {
  const host = useRef<HTMLDivElement | null>(null);
  const [hostEl, setHostEl] = useState<HTMLDivElement | null>(null);
  const hostRef = useCallback((el: HTMLDivElement | null) => {
    host.current = el;
    setHostEl(el);
  }, []);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const callbackRef = useRef(onChange);
  const exportRef = useRef(onExport);
  const nameRef = useRef(name);
  const openSettingsRef = useRef(onOpenSettings);
  const openGraphRef = useRef(onOpenGraph);
  const toggleHistoryRef = useRef(onToggleHistory);
  const ready = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<Snapshot | null>(null);
  const signature = useRef("");
  const pendingChanges = useRef(false);
  const fileRefs = useRef<BinaryFiles>({});
  const releasePreview = useRef<(() => void) | null>(null);
  const [exporting, setExporting] = useState(false);
  const exportingRef = useRef(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  // The document whose scene the editor shows (null until the first load).
  const [loadedDocId, setLoadedDocId] = useState<string | null>(null);
  const apiReady = loadedDocId === documentId;
  const sceneDocId = useRef<string | null>(null);
  const propDocId = useRef(documentId);
  propDocId.current = documentId;
  // What the first load was started for (the props may move on while it runs).
  const initialDocId = useRef(documentId);
  const initialRestore = useRef<EditorRestore | undefined>(undefined);
  // Bumped to rebuild Excalidraw itself after a failed swap.
  const [mountKey, setMountKey] = useState(0);
  const [swapping, setSwapping] = useState(false);
  const wantFocus = useRef(false);
  const [paperDialogOpen, setPaperDialogOpen] = useState(false);
  const [pageSetupOpen, setPageSetupOpen] = useState(false);
  const handledFocusNonce = useRef<number | null>(null);
  const [libraryApi, setLibraryApi] = useState<ExcalidrawImperativeAPI | null>(
    null,
  );
  const { libraryUIOptions, onAppState } = useVaultLibrary(library, libraryApi);
  const linkIndicator = useLinkIndicator(theme ?? "light", window);
  // Links act on the scene, so they wait while another document's scene is shown.
  const editorLinks = useVaultEditorLinks(
    apiReady ? libraryApi : null,
    hostEl,
    links,
    libraryApi,
  );
  const pens = usePens(apiRef, !readOnly && !disabled);
  const onPenAppState = pens.onAppState;
  const scheduleSaveRef = useRef<() => void>(() => {});
  const toolDefaults = useToolDefaults(apiRef, !readOnly && !disabled, {
    onOverridesChange: () => scheduleSaveRef.current(),
  });
  const { getDrawingStyles, getOverridesVersion, loadDrawingStyles } =
    toolDefaults;
  const onToolAppState = toolDefaults.onAppState;
  useEditorPalette({
    apiRef,
    disabled,
    presets: pens.presets,
    activePen: pens.active,
    selectPen: pens.selectPen,
    openPaperSettings: () => setPaperDialogOpen(true),
    libraryStore: library?.store ?? null,
  });

  // One subscription for both switches; the set object is stable until a
  // switch changes, so it never re-renders the editor on open.
  // Mermaid is the official mermaid plugin: on while its switch and the plugin list allow it.
  const mermaidOn = usePluginOn("mermaid");
  // Stable: Excalidraw's memo compares UIOptions entries by reference, and a
  // new `tools` object per render would re-render the whole editor.
  const uiTools = useMemo(
    () => ({ image: true, mermaid: mermaidOn }),
    [mermaidOn],
  );
  // Mermaid turned off while its dialog is open: close it (the editor stops
  // rendering it, so a stale openDialog would otherwise linger).
  useEffect(() => {
    const api = apiRef.current;
    if (!mermaidOn && api?.getAppState().openDialog?.name === "ttd") {
      api.updateScene({ appState: { openDialog: null } });
    }
  }, [mermaidOn, apiRef]);
  // Double-click on a formula image: the formula plugin (when on) opens its editor.
  const onImageEdit = useCallback(
    (el: ExcalidrawImageElement) => {
      const api = apiRef.current;
      const win = host.current?.ownerDocument.defaultView;
      if (!api || !win || readOnly || disabled) {
        return false;
      }
      return editFormulaImage(win, el, api.getAppState().viewModeEnabled);
    },
    [apiRef, host, readOnly, disabled],
  );

  useMemoryRetention({ apiRef, active: apiReady && !disabled });

  const pageMode = usePageMode({
    apiRef,
    getWindow: () => host.current?.ownerDocument.defaultView ?? null,
    disabled,
    readOnly,
    openPageSetup: () => setPageSetupOpen(true),
  });
  const onPageChange = pageMode.onChange;

  const writableRef = useRef(!readOnly && !disabled);
  writableRef.current = !readOnly && !disabled;
  const markdown = useMarkdownMode({
    getWindow: () => host.current?.ownerDocument.defaultView ?? null,
    getApi: () => apiRef.current,
    getContainer: () => host.current,
    isWritable: () => writableRef.current,
    onChange: () => scheduleSaveRef.current(),
  });
  const getMarkdownForSave = markdown.getForSave;
  const loadMarkdown = markdown.load;

  // The "move canvas" hint disappears after the user's first pan (persisted).
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) {
      return;
    }
    if (getPreferences().hasPanned) {
      el.classList.add(PANNED_CLASS);
      return;
    }
    return watchFirstPan(
      el,
      () => apiRef.current?.getAppState().activeTool.type,
      () => {
        el.classList.add(PANNED_CLASS);
        updatePreferences({ hasPanned: true });
      },
    );
  }, []);

  const importMenuItems = useCanvasImportMenu(
    onImportFile,
    !readOnly && !disabled,
  );
  const menuPathRef = useRef(path);
  menuPathRef.current = path;
  /** The import item plus the items plugins declared for the canvas menu (none without plugins). */
  const canvasContextMenuItems = useCallback(
    (at: ScenePoint): HostContextMenuItem[] => {
      const base = importMenuItems(at);
      const plugin = getMenuItems("canvas");
      return plugin.length === 0
        ? base
        : [
            ...base,
            ...plugin.map((it) => ({
              name: `plugin-menu-${it.command}`,
              label: it.title,
              onSelect: () =>
                runMenuItem(it, {
                  surface: "canvas",
                  path: menuPathRef.current ?? null,
                  at: { x: at.x, y: at.y },
                }),
            })),
          ];
    },
    [importMenuItems],
  );
  const dropRef = useRef({ path, readOnly: readOnly || disabled });
  dropRef.current = { path, readOnly: readOnly || disabled };

  /** Plugin-imported files in a drop; false leaves the drop to the paths below. */
  const dropPluginFiles = useCallback(
    (event: DragEvent<HTMLDivElement>): boolean => {
      const files = Array.from(event.dataTransfer.files);
      const plan = planImport(files);
      if (!plan.plugin.length) {
        return false;
      }
      const { path: target, readOnly: locked } = dropRef.current;
      const api = apiRef.current;
      // Importers that make their own drawing (Markdown) never touch this scene: they run even when it is read-only.
      const own = plan.plugin.filter((i) =>
        createsOwnDrawing(i.match.pluginId),
      );
      if (own.length === 0 && !locked && (!api || !target)) {
        return false; // no scene is shown yet: today's behaviour
      }
      event.preventDefault();
      event.stopPropagation();
      const at = api
        ? viewportCoordsToSceneCoords(event, api.getAppState())
        : { x: 0, y: 0 };
      if (own.length > 0) {
        void runImports(own, { path: target ?? null, at }).then((ran) => {
          if (!ran) {
            setEditorError(skippedMessage(own.map((i) => i.file)));
          }
        });
      }
      const inDrawing = plan.plugin.filter((i) => !own.includes(i));
      if (locked || !api || !target) {
        if (inDrawing.length > 0 || own.length === 0) {
          setEditorError("This drawing is read-only");
        }
        return true;
      }
      if (inDrawing.length > 0) {
        void runImports(inDrawing, { path: target, at }).then((ran) => {
          if (!ran) {
            setEditorError(skippedMessage(inDrawing.map((i) => i.file)));
          }
        });
      }
      if (plan.images.length) {
        void api.insertImages(plan.images, at);
      }
      setEditorError(skippedMessage(plan.skipped));
      return true;
    },
    [],
  );

  const guardSceneDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      // Shift keeps Excalidraw's own handling (insert scene content).
      if (!event.shiftKey && hasImporters() && dropPluginFiles(event)) {
        return;
      }
      // Files that carry a scene (.excalidraw/.json, or Excalidraw's
      // "embed scene" exports named *.excalidraw.png/.svg) would replace the
      // drawing. Plain images are inserted as image elements, so let them through.
      const mayReplaceScene = Array.from(event.dataTransfer.files).some(
        (file) =>
          /\.(excalidraw|json)$/i.test(file.name) ||
          /\.excalidraw\.(png|svg)$/i.test(file.name) ||
          file.type === "application/vnd.excalidraw+json",
      );
      if (mayReplaceScene && !event.shiftKey) {
        // The core editor normally replaces the scene on file drop. In a vault
        // that would autosave imported content over the current source file.
        event.preventDefault();
        event.stopPropagation();
        setEditorError(
          "To open another drawing, copy it into your vault and select it in the navigator. Hold Shift while dropping to insert content without replacing this drawing.",
        );
      } else if (mayReplaceScene) {
        setEditorError(null);
      }
    },
    [dropPluginFiles],
  );
  callbackRef.current = onChange;
  exportRef.current = onExport;
  nameRef.current = name;
  openSettingsRef.current = onOpenSettings;
  openGraphRef.current = onOpenGraph;
  const canOpenGraph = !!onOpenGraph;
  toggleHistoryRef.current = onToggleHistory;
  const canToggleHistory = !!onToggleHistory;
  const canExport = !!onExport;
  const canOpenSettings = !!onOpenSettings;

  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  const initialSourceRef = useRef(initialSource);
  initialSourceRef.current = initialSource;

  const initialData = useCallback(async () => {
    const doc = host.current?.ownerDocument;
    if (!doc) {
      throw new Error("Editor document is not mounted");
    }
    initialDocId.current = documentId;
    initialRestore.current = restoreRef.current;
    try {
      // Never inherits a file handle or scene from a previously open document.
      markOpen("parse");
      const scene = await loadScene(
        initialSource.json,
        restoreRef.current?.view,
      );
      markOpen("parsed");
      loadDrawingStyles(readDrawingStyles(initialSource.json));
      loadMarkdown(readDrawingMarkdown(initialSource.json));
      return scene;
    } catch (cause) {
      setEditorError(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    }
    // documentId: a new document must load fresh even with identical JSON.
    // The source is read at call time so it always yields the latest saved text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSource, documentId, mountKey]);

  const commitTextEditing = useCallback(() => {
    const mounted = host.current;
    const doc = mounted?.ownerDocument;
    const focused = doc?.activeElement;
    // Excalidraw's WYSIWYG editor commits its controlled text on blur. Only blur
    // when an explicit barrier (file switch, window close, save copy) is required.
    if (
      focused &&
      mounted?.contains(focused) &&
      (focused.matches('[contenteditable="true"]') ||
        focused.tagName === "TEXTAREA")
    ) {
      (focused as HTMLElement).blur();
    }
  }, []);

  const serializePending = useCallback(() => {
    // IMPORTANT: DO NOT call commitTextEditing() here!
    // Blurring during idle debounce removes focus while typing, which makes
    // subsequent keystrokes trigger canvas tool shortcuts.
    if (timer.current) {
      clearTimeout(timer.current);
    }
    if (maxTimer.current) {
      clearTimeout(maxTimer.current);
    }
    timer.current = maxTimer.current = null;
    const current = latest.current;
    // Never save a scene under a document it does not belong to.
    if (
      !ready.current ||
      isSwapping(sceneDocId.current, propDocId.current) ||
      !current ||
      !pendingChanges.current
    ) {
      return;
    }
    pendingChanges.current = false;
    callbackRef.current(
      serializeSceneForSave(
        current[0],
        current[1],
        current[2],
        getDrawingStyles(),
        getMarkdownForSave(),
      ),
    );
  }, [getDrawingStyles, getMarkdownForSave]);

  const scheduleSave = useCallback(() => {
    if (isSwapping(sceneDocId.current, propDocId.current)) {
      return; // belongs to the scene on its way out
    }
    pendingChanges.current = true;
    if (timer.current) {
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(serializePending, IDLE_SERIALIZE_MS);
    if (!maxTimer.current) {
      maxTimer.current = setTimeout(serializePending, MAX_SERIALIZE_MS);
    }
  }, [serializePending]);
  scheduleSaveRef.current = scheduleSave;

  const flushImmediate = useCallback(
    (options?: FlushOptions) => {
      if (options?.commitText) {
        commitTextEditing();
      }
      serializePending();
    },
    [commitTextEditing, serializePending],
  );

  useEffect(
    () => registerEditorFlush(documentId, flushImmediate),
    [documentId, flushImmediate],
  );

  const activeMeta = useRef({ path, readOnly: documentReadOnly ?? readOnly });
  activeMeta.current = { path, readOnly: documentReadOnly ?? readOnly };

  useEffect(
    () =>
      apiReady && apiRef.current
        ? registerEditorApi(
            documentId,
            apiRef.current,
            () => activeMeta.current,
          )
        : undefined,
    // apiReady is false while another document's scene is shown under this id.
    [documentId, apiReady],
  );

  useEffect(
    () => (libraryApi ? registerLiveEditor(libraryApi) : undefined),
    [libraryApi],
  );

  // Tool keys (tool.* commands): Excalidraw's built-in letters are turned off
  // only after the handlers are bound, so a key is never dead for a frame. No
  // API (or an Excalidraw without the hook) keeps the built-in keys.
  const [toolKeysBound, setToolKeysBound] = useState(false);
  const hasActionHook = typeof libraryApi?.runActionShortcut === "function";
  useEffect(() => {
    if (!libraryApi || typeof libraryApi.activateToolShortcut !== "function") {
      return undefined;
    }
    const unbind = registerCommandHandlers(createToolHandlers(libraryApi));
    // Action keys (canvas.* commands): one prefix handler, bound in this same
    // effect so opening an editor costs one extra state flip, not two.
    const unbindActions =
      typeof libraryApi.runActionShortcut === "function"
        ? bindActionCommands(libraryApi)
        : undefined;
    // Not in a history preview, not while link hints are typing letters.
    const undefine = defineContextKey(
      TOOL_KEYS_CONTEXT,
      () =>
        !document.activeElement?.closest("[data-testid='history-preview']") &&
        !document.querySelector(".vault-link-hint"),
    );
    const undefineActions = unbindActions
      ? defineContextKey(
          ACTION_KEYS_CONTEXT,
          () =>
            !document.activeElement?.closest(
              "[data-testid='history-preview']",
            ) &&
            !document.querySelector(".vault-link-hint") &&
            libraryApi.getAppState().openDialog?.name !== "elementLinkSelector",
        )
      : undefined;
    setToolKeysBound(true);
    return () => {
      setToolKeysBound(false);
      undefineActions?.();
      unbindActions?.();
      undefine();
      unbind();
    };
  }, [libraryApi]);

  // Canvas sync: the display colour transform changed (theme, mode, sync
  // toggle, export). Element caches invalidate on the next render, so force
  // one by re-committing the same elements (no history entry, no save: the
  // scene version is unchanged).
  useEffect(
    () =>
      registerCanvasRepaint(() => {
        const api = apiRef.current;
        if (!api || !ready.current) {
          return;
        }
        api.updateScene({
          elements: api.getSceneElementsIncludingDeleted(),
          captureUpdate: CaptureUpdateAction.NEVER,
        });
      }),
    [],
  );

  const onEditorChange = useCallback(
    (elements: Snapshot[0], appState: Snapshot[1], files: Snapshot[2]) => {
      if (isSwapping(sceneDocId.current, propDocId.current)) {
        return; // the shown scene is on its way out: not worth tracking
      }
      latest.current = [elements, appState, files];
      onAppState(appState);
      onPenAppState(appState);
      onToolAppState(appState);
      if (!ready.current) {
        return;
      }
      onPageChange(elements, appState);
      rememberExportOptions(appState);
      // The dialog's live preview must show standard colours, not theme sync.
      const previewing = appState.openDialog?.name === "imageExport";
      if (previewing && !releasePreview.current) {
        releasePreview.current = suspendCanvasSync();
      } else if (!previewing && releasePreview.current) {
        releasePreview.current();
        releasePreview.current = null;
      }
      const nextSignature = getSaveSignature(
        elements,
        appState,
        getOverridesVersion(),
      );
      // A file added or replaced changes the saved scene. One only dropped
      // from memory (memory.free_unused_images: nothing can bring it back,
      // and the saved scene never held it) does not: no rewrite for it.
      const fileChanged = Object.keys(files).some(
        (id) => files[id] !== fileRefs.current[id],
      );
      if (signature.current === nextSignature && !fileChanged) {
        fileRefs.current = files;
        return;
      }
      signature.current = nextSignature;
      fileRefs.current = files;
      scheduleSave();
    },
    [
      scheduleSave,
      getOverridesVersion,
      onAppState,
      onPenAppState,
      onToolAppState,
      onPageChange,
    ],
  );

  /** The editor shows `docId`'s scene: track it, save it, publish it. */
  const armScene = useCallback(
    (api: ExcalidrawImperativeAPI, docId: string) => {
      apiRef.current = api;
      latest.current = [
        api.getSceneElements(),
        api.getAppState(),
        api.getFiles(),
      ];
      signature.current = getSaveSignature(
        latest.current[0],
        latest.current[1],
        getOverridesVersion(),
      );
      fileRefs.current = latest.current[2];
      sceneDocId.current = docId;
      ready.current = true;
      onPageChange(latest.current[0], latest.current[1]);
    },
    [onPageChange, getOverridesVersion],
  );

  const onInitialize = useCallback(
    (api: ExcalidrawImperativeAPI) => {
      setLibraryApi(api);
      markOpen("landed");
      armScene(api, initialDocId.current);
      setLoadedDocId(initialDocId.current);
    },
    [armScene],
  );

  const resetPens = pens.reset;
  const resetToolDefaults = toolDefaults.reset;
  const resetPageMode = pageMode.reset;
  useSceneSwap({
    documentId,
    loadedDocId,
    host,
    getApi: () => apiRef.current,
    getSource: () => initialSourceRef.current,
    getRestore: () => restoreRef.current,
    begin: () => {
      // From now on the shown scene is not the props' document: nothing it
      // reports may reach the save callback.
      ready.current = false;
      if (timer.current) {
        clearTimeout(timer.current);
      }
      if (maxTimer.current) {
        clearTimeout(maxTimer.current);
      }
      timer.current = maxTimer.current = null;
      pendingChanges.current = false;
      releasePreview.current?.();
      releasePreview.current = null;
      wantFocus.current = true;
      setSwapping(true);
    },
    beforeApply: (json) => {
      resetPens();
      resetToolDefaults();
      // the new drawing's own style picks; the old drawing's are gone
      loadDrawingStyles(readDrawingStyles(json));
      loadMarkdown(readDrawingMarkdown(json));
      resetPageMode();
      setPageSetupOpen(false);
      setPaperDialogOpen(false);
      setEditorError(null);
    },
    // batched into the landing commit: the shown document flips with its scene
    landing: (docId) => {
      setLoadedDocId(docId);
      setSwapping(false);
    },
    afterApply: armScene,
    fail: (cause) => {
      // eslint-disable-next-line no-console
      console.error("[editor] scene swap failed, rebuilding the editor", cause);
      sceneDocId.current = null;
      ready.current = false;
      setLoadedDocId(null);
      setSwapping(false);
      setMountKey((key) => key + 1);
    },
  });

  // Tabs: bring back the first document's undo history (kept only when the
  // file is unchanged since it was captured; takeUndo returns nothing
  // otherwise). Later documents are handled by the swap.
  useEffect(() => {
    const api = apiRef.current;
    const first = initialRestore.current;
    if (!apiReady || !api || !first) {
      return;
    }
    initialRestore.current = undefined;
    const undo = first.takeUndo();
    if (undo) {
      api.history.import(undo as Parameters<typeof api.history.import>[0]);
    }
  }, [apiReady]);

  // While the app loads another document, nothing may be typed into the
  // drawing about to be replaced (keys go to the document-level listeners).
  useEffect(() => {
    const el = host.current;
    return loading && el ? blockEditorKeys(el) : undefined;
  }, [loading]);

  // A fresh editor focuses its canvas (autoFocus); a swapped one does the same
  // once nothing blocks it (the app's own loading state makes the container inert).
  useEffect(() => {
    if (!wantFocus.current || swapping || loading || !apiReady) {
      return;
    }
    wantFocus.current = false;
    host.current
      ?.querySelector<HTMLElement>(".excalidraw-container")
      ?.focus({ preventScroll: true });
  }, [swapping, loading, apiReady]);

  // Search results: focus the requested element once per request, after the
  // scene is loaded and laid out.
  useEffect(() => {
    if (!apiReady || !focusRequest) {
      return;
    }
    if (handledFocusNonce.current === focusRequest.nonce) {
      return;
    }
    handledFocusNonce.current = focusRequest.nonce;
    const win = host.current?.ownerDocument.defaultView;
    let ran = false;
    const run = () => {
      ran = true;
      const api = apiRef.current;
      if (api) {
        focusElement(api, focusRequest);
      }
    };
    const frame = win ? win.requestAnimationFrame(run) : null;
    return () => {
      if (frame !== null && !ran) {
        win?.cancelAnimationFrame(frame);
        // Cancelled before it ran (StrictMode remount): allow a retry.
        handledFocusNonce.current = null;
      }
    };
  }, [apiReady, focusRequest]);

  useEffect(
    () => () => {
      ready.current = false;
      if (timer.current) {
        clearTimeout(timer.current);
      }
      if (maxTimer.current) {
        clearTimeout(maxTimer.current);
      }
      timer.current = maxTimer.current = null;
      apiRef.current = null;
      releasePreview.current?.();
      releasePreview.current = null;
    },
    [],
  );

  const onExcalidrawAPI = useCallback((api: ExcalidrawImperativeAPI | null) => {
    if (!api) {
      apiRef.current = null;
    }
  }, []);

  const saveCopy = useCallback(async () => {
    const api = apiRef.current;
    const mounted = host.current;
    if (!api || !mounted || !exportRef.current || exportingRef.current) {
      return;
    }
    const ownerDocument = mounted.ownerDocument;
    const baseName = drawingStem(nameRef.current) || "Drawing";
    exportingRef.current = true;
    setExporting(true);
    try {
      const json = serializeSceneForSave(
        api.getSceneElements(),
        api.getAppState(),
        api.getFiles(),
        getDrawingStyles(),
        getMarkdownForSave(),
      );
      const blob = new ownerDocument.defaultView!.Blob([json], {
        type: "application/json",
      });
      await exportRef.current(
        `${baseName}.excalidraw`,
        new Uint8Array(await blob.arrayBuffer()),
      );
      setEditorError(null);
    } catch (cause) {
      setEditorError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  }, [getDrawingStyles, getMarkdownForSave]);

  // Every image export (dialog, shortcuts, context menu copy) lands here.
  // Throwing makes the editor show its own error.
  const handleExportImage = useCallback(async (request: ImageExportRequest) => {
    const win = host.current?.ownerDocument.defaultView;
    if (!win) {
      throw new Error("Editor window is not mounted");
    }
    const started = performance.now();
    const image = await renderImageExport(request, win);
    const rendered = performance.now();
    if (request.type === "clipboard" || request.type === "clipboard-svg") {
      await copyToClipboard(
        request.type === "clipboard" ? "png" : "svg",
        image.bytes,
        win,
      );
    } else if (exportRef.current) {
      // false = the user cancelled the save dialog, not an error.
      await exportRef.current(image.fileName, image.bytes);
    } else {
      throw new Error("Exporting files is not available.");
    }
    // eslint-disable-next-line no-console
    console.debug(
      `[export] ${request.type} render ${Math.round(
        rendered - started,
      )} ms, ipc ${Math.round(performance.now() - rendered)} ms, ${
        image.bytes.byteLength
      } bytes`,
    );
  }, []);

  // Excalidraw's memo bails out only when `children` is the same element tree,
  // so rebuild it only when something it shows changes (not on every
  // VaultApp render, e.g. each autosave status change).
  const hasLibrary = !!library;
  // The official markdown-import plugin's command exists as a stub from boot, so this costs no plugin code.
  const hasPdfImport = useSyncExternalStore(
    subscribeCommands,
    () => !!getRegisteredCommand(PDF_IMPORT_COMMAND_ID),
    () => false,
  );
  const hasObsidianImport = useSyncExternalStore(
    subscribeCommands,
    () => !!getRegisteredCommand(OBSIDIAN_IMPORT_COMMAND_ID),
    () => false,
  );
  const editorChildren = useMemo(
    () => (
      <>
        {/* A book, not Excalidraw's "panel" glyph, which reads as a sidebar toggle. */}
        {hasLibrary && (
          <DefaultSidebar.Trigger
            icon={<IconLibrary />}
            title="Library"
            tab={DEFAULT_SIDEBAR.defaultTab}
          />
        )}
        {/* Mirrors excalidraw.com's menu, with vault-safe export actions
              instead of open/save-as (the vault file is always the source). */}
        <MainMenu>
          <MainMenu.DefaultItems.SaveAsImage />
          <CommandMenuItem
            commandId="file.saveCopy"
            icon={saveAs}
            onSelect={() => void saveCopy()}
            disabled={exporting || !canExport}
          >
            Save a copy…
          </CommandMenuItem>
          {hasPdfImport && (
            <CommandMenuItem
              commandId={PDF_IMPORT_COMMAND_ID}
              icon={LoadIcon}
              onSelect={() =>
                void getAppCommandRunner()?.(PDF_IMPORT_COMMAND_ID)
              }
              disabled={readOnly || disabled}
            >
              Import PDF…
            </CommandMenuItem>
          )}
          {hasObsidianImport && (
            <CommandMenuItem
              commandId={OBSIDIAN_IMPORT_COMMAND_ID}
              icon={LoadIcon}
              onSelect={() =>
                void getAppCommandRunner()?.(OBSIDIAN_IMPORT_COMMAND_ID)
              }
            >
              Import Obsidian vault…
            </CommandMenuItem>
          )}
          <MainMenu.DefaultItems.SearchMenu />
          <MainMenu.DefaultItems.Help />
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.Separator />
          {canOpenGraph && (
            <CommandMenuItem
              commandId={GRAPH_COMMAND_IDS.open}
              icon={<IconGraph strokeWidth="1.25" />}
              onSelect={() => openGraphRef.current?.()}
            >
              Graph view
            </CommandMenuItem>
          )}
          {canToggleHistory && (
            <CommandMenuItem
              commandId={HISTORY_COMMAND_IDS.toggle}
              icon={<IconHistory strokeWidth="1.25" />}
              onSelect={() => toggleHistoryRef.current?.()}
            >
              History
            </CommandMenuItem>
          )}
          {canOpenSettings && (
            <CommandMenuItem
              commandId="settings.open"
              icon={settingsIcon}
              onSelect={() => openSettingsRef.current?.()}
            >
              Vault settings
            </CommandMenuItem>
          )}
          <CommandMenuItem
            commandId="view.focusMode"
            icon={fullscreenIcon}
            onSelect={() => void getAppCommandRunner()?.("view.focusMode")}
          >
            Focus mode
          </CommandMenuItem>
          <MainMenu.DefaultItems.ToggleTheme allowSystemTheme={false} />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
          <PaperMenuItem onOpenSettings={() => setPaperDialogOpen(true)} />
          <PageMenuItem onOpenSetup={() => setPageSetupOpen(true)} />
        </MainMenu>
        {pageSetupOpen && (
          <PageSetupDialog
            onClose={() => setPageSetupOpen(false)}
            ownerDocument={host.current?.ownerDocument}
          />
        )}
        {paperDialogOpen && (
          <PaperDialog
            onClose={() => setPaperDialogOpen(false)}
            ownerDocument={host.current?.ownerDocument}
          />
        )}
        <Footer>
          <MarkdownChip
            on={markdown.on}
            disabled={readOnly || disabled}
            onToggle={markdown.toggle}
          />
        </Footer>
      </>
    ),
    [
      markdown.on,
      markdown.toggle,
      exporting,
      canExport,
      canOpenSettings,
      canOpenGraph,
      canToggleHistory,
      hasPdfImport,
      readOnly,
      disabled,
      hasObsidianImport,
      saveCopy,
      paperDialogOpen,
      pageSetupOpen,
      hasLibrary,
    ],
  );

  return (
    <div
      ref={hostRef}
      className="vault-editor"
      // The document whose scene is on screen (not yet the props' during a swap).
      data-document-id={loadedDocId ?? documentId}
      // The scene named above has landed and no swap is running (see sceneReady.ts).
      data-scene-ready={apiReady && !swapping ? "true" : "false"}
      // The app is still reading or closing a document: input is blocked.
      data-loading={loading ? "true" : "false"}
      onDropCapture={guardSceneDrop}
    >
      <LoadingLine active={loading || swapping} />
      {editorError && <div role="alert">{editorError}</div>}
      <Excalidraw
        key={mountKey}
        name={name}
        theme={theme}
        onThemeChange={onThemeChange}
        handleKeyboardGlobally={true}
        autoFocus={true}
        initialData={initialData}
        onChange={onEditorChange}
        onInitialize={onInitialize}
        onExcalidrawAPI={onExcalidrawAPI}
        onImageEdit={onImageEdit}
        onPaste={(data) => onEditorPaste(data, apiRef.current)}
        canvasContextMenuItems={canvasContextMenuItems}
        validateEmbeddable={false}
        viewModeEnabled={readOnly}
        interaction={disabled ? false : undefined}
        onExportImage={handleExportImage}
        onLinkOpen={editorLinks.onLinkOpen}
        linkIndicator={linkIndicator}
        aiEnabled={false}
        freedrawPen={pens.freedrawPen}
        currentItemStrokeWidth={toolDefaults.currentItemStrokeWidth}
        newTextStyle={toolDefaults.newTextStyle}
        textEditorExtension={markdown.textEditorExtension}
        newContainerStyle={toolDefaults.newContainerStyle}
        styleOverrides={toolDefaults.styleOverrides}
        laserPointerOptions={pens.laserPointerOptions}
        libraryUIOptions={libraryUIOptions}
        UIOptions={{
          toolShortcuts: !toolKeysBound,
          hostActionKeys:
            toolKeysBound && hasActionHook ? HOST_ACTION_NAMES : undefined,
          tools: uiTools,
          canvasActions: {
            toggleTheme: true,
            export: false,
            loadScene: false,
            saveToActiveFile: false,
            saveAsImage: true,
          },
        }}
      >
        {editorChildren}
      </Excalidraw>
      {editorLinks.overlays}
      {!readOnly && !disabled && <PluginToolbar win={window} />}
      {pageMode.notice && <PageNotice {...pageMode.notice} />}
      {pens.freedrawActive && !readOnly && !disabled && (
        <PenBar
          presets={pens.presets}
          shortcuts={pens.shortcuts}
          active={pens.active}
          onSelect={pens.selectPen}
          onOpenSettings={onOpenSettings && (() => onOpenSettings("tools:pen"))}
        />
      )}
    </div>
  );
};

export const VaultEditor = memo(VaultEditorComponent);
export default VaultEditor;
