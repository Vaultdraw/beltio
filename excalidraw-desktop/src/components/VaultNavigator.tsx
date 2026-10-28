import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { entryDisplayName, stripDrawingExt } from "../vault/fileKind";

import { getMenuItems, runMenuItem } from "../plugins/menuRegistry";
import { getPreferences, updatePreferences } from "../vault/preferences";
import { useGlobalPref } from "../vault/useGlobalPref";
import "../sync/sync.css";
import { SORT_LABELS, SORT_ORDERS, type SortOrder } from "../vault/sortOrder";
import { checkTreeDrop, getParentPath } from "../vault/treeStore";

import { useVaultTags } from "../tags/useVaultTags";

import { tagQuery, type TagSort } from "../tags/types";
import { registerTagActions } from "../tags/tagActions";
import { tagStore } from "../tags/tagStore";
import { registerPaletteProvider } from "../palette/registry";
import { createTagsProvider } from "../palette/providers/tags";

import { isNewTabClick } from "../tabs/newTabClick";
import { useListKeys } from "../commands/useListKeys";
import { focusList } from "../commands/listNav";
import { registerCommandHandlers } from "../commands/handlerRegistry";
import {
  CLEAR_SEARCH_COMMAND_ID,
  FOCUS_TREE_COMMAND_ID,
} from "../commands/listCommands";
import { focusCanvasIfIdle } from "../palette/focus";

import {
  IconChevronDown,
  IconChevronRight,
  IconChevronsUpDown,
  IconClose,
  IconCheck,
  IconCopy,
  IconDrawing,
  IconNote,
  IconEdit,
  IconExportDocument,
  IconExportImage,
  IconExportVector,
  IconFolder,
  IconFolderPlus,
  IconGraph,
  IconHistory,
  IconMore,
  IconMove,
  IconNewDrawing,
  IconPlus,
  IconRefresh,
  IconReveal,
  IconSaveCopy,
  IconSearch,
  IconSettings,
  IconSort,
  IconTemplate,
  IconTrash,
} from "./Icons";
import { GraphViewButton } from "./GraphViewButton";
import { SearchResults } from "./search/SearchResults";
import { TagChips } from "./tags/TagChips";
import { TagsPanel, type TagsPanelHandle } from "./tags/TagsPanel";

import { ConfirmModal } from "./ConfirmModal";
import { Dialog } from "./Dialog";
import { MoveModal } from "./MoveModal";
import { RenameModal } from "./RenameModal";
import { flattenTree } from "./tree/flattenTree";
import { TREE_ROW_HEIGHT, useTreeWindow } from "./tree/useTreeWindow";
import { ghostTransform, useTreeDrag } from "./tree/useTreeDrag";
import {
  lazyTreeController,
  targetFolder,
  type TreeKeyDeps,
} from "./tree/treeKeys";

import type { ReactNode } from "react";

import type { OpenTarget } from "../tabs/types";

import type { TreeNode } from "../vault/treeStore";
import type { TreeRow as TreeRowData } from "./tree/flattenTree";

import type { DragSource } from "./tree/useTreeDrag";

import type { ElementMatch, VaultSearch } from "../search/types";

import type { EntryKind, VaultEntry, VaultInfo } from "../vault/types";

import type { ExplorerExportFormat } from "../export/exportFromFile";

const DEFAULT_WIDTH = 280;
const clampWidth = (value: number) =>
  Math.round(Math.min(480, Math.max(200, value || DEFAULT_WIDTH)));

/**
 * A one-shot action asked of the navigator from outside (the command
 * palette): a new nonce re-triggers it. Dialog kinds act on `path`.
 */
export type NavigatorAction =
  | { kind: "newFolder" }
  | { kind: "newDrawingInFolder" }
  | { kind: "rename" | "move" | "trash"; path: string }
  | { kind: "search"; query: string }
  /** Focus and scroll to a row (the caller expanded its folders). */
  | { kind: "reveal"; path: string };

export type NavigatorRequest = NavigatorAction & { nonce: number };

interface VaultNavigatorProps {
  vault: VaultInfo;
  activePath: string | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpenDrawing: (path: string, opts?: { target: OpenTarget }) => unknown;
  /** A Markdown note was chosen in the tree (the notes plugin handles it; nothing opens without it). */
  onOpenNote?: (path: string, opts?: { target: OpenTarget }) => unknown;
  /** Vault-wide search backend; null = name-only search over the loaded tree. */
  search?: VaultSearch | null;
  /**
   * Source of the tags pane and tag chips; null = tags off
   * (`extensions.tags`). Omitted: `search`.
   */
  tagSearch?: VaultSearch | null;
  onOpenSearchResult?: (
    path: string,
    match?: ElementMatch,
    opts?: { target: OpenTarget },
  ) => void | Promise<void>;
  /** Bump to focus and select the search input (Cmd+Shift+F). */
  searchFocusNonce?: number;
  /** Palette-triggered action; see NavigatorRequest. */
  request?: NavigatorRequest | null;
  onCreateDrawing: (parentPath: string, name: string) => void | Promise<void>;
  onCreateFolder: (parentPath: string, name: string) => void | Promise<void>;
  onRenameEntry: (path: string, newName: string) => void | Promise<void>;
  onMoveEntry: (
    sourcePath: string,
    destinationParentPath: string,
  ) => void | Promise<void>;
  onDuplicateDrawing: (path: string) => void | Promise<void>;
  onSaveAsTemplate?: (path: string) => void;
  onTrashEntry: (path: string) => void | Promise<void>;
  onRevealEntry: (path: string) => void | Promise<void>;
  /** Drawing rows: Export as PNG/SVG/PDF…, Save a copy… */
  onExportDrawing?: (
    path: string,
    format: ExplorerExportFormat,
  ) => void | Promise<void>;
  onSwitchVault: () => void | Promise<void>;
  treeNodes: TreeNode[];
  expandedFolders: Set<string>;
  onToggleFolder: (folderPath: string) => void;
  onExpandFolder: (folderPath: string) => void;
  allIndexedEntries: VaultEntry[];
  isIndexing?: boolean;
  /** Starts the vault file list if it waits for first use (files.list_start). */
  onNeedIndex?: () => void;
  onRefresh?: () => void;
  onOpenSettings?: () => void;
  sortOrder: SortOrder;
  onSortChange: (order: SortOrder) => void;
  /** False: "Move to Trash" acts immediately, without the dialog. */
  confirmDelete: boolean;
  /** Show tag chips after drawing names (default on). */
  showTagChips?: boolean;
  /** Order of the Tags pane when the vault has no saved choice (`tags.pane_sort`). */
  tagsDefaultSort?: TagSort;
  /** Rename a tag (key, display): the Tags pane row action and r/F2. */
  onRenameTag?: (key: string, display: string) => void;
  /** Rendered between the tree and the footer (the Links dock). */
  dockSlot?: ReactNode;
  /** Toolbar button: run graph.open (it toggles the graph view). */
  onOpenGraph?: () => void;
  /** The graph view is showing (the toolbar button is pressed). */
  graphOpen?: boolean;
  /** Drawing rows: "Open local graph", centred on that drawing. */
  onOpenLocalGraph?: (path: string) => void | Promise<void>;
  /** Drawing rows: "History", the History panel of that drawing. */
  onShowHistory?: (path: string) => void | Promise<void>;
  /** Sync-service rows: a click on a not-downloaded file, and the row menu's compare / download. */
  onSyncAction?: (
    entry: VaultEntry,
    action: "compare" | "download" | "open",
  ) => void;
  ownerDocument?: Document | null;
}

export const VaultNavigator = ({
  vault,
  activePath,
  collapsed,
  onToggleCollapse,
  onOpenDrawing,
  onOpenNote,
  search = null,
  tagSearch,
  onOpenSearchResult,
  searchFocusNonce = 0,
  request = null,
  onCreateDrawing,
  onCreateFolder,
  onRenameEntry,
  onMoveEntry,
  onDuplicateDrawing,
  onSaveAsTemplate,
  onTrashEntry,
  onRevealEntry,
  onExportDrawing,
  onSwitchVault,
  treeNodes,
  expandedFolders,
  onToggleFolder,
  onExpandFolder,
  allIndexedEntries,
  isIndexing = false,
  onNeedIndex,
  onRefresh,
  onOpenSettings,
  sortOrder,
  onSortChange,
  confirmDelete,
  showTagChips = true,
  tagsDefaultSort,
  onRenameTag,
  dockSlot,
  onOpenGraph,
  graphOpen = false,
  onOpenLocalGraph,
  onShowHistory,
  onSyncAction,
  ownerDocument,
}: VaultNavigatorProps) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [focusedPath, setFocusedPath] = useState<string | null>(null);

  // Modals state
  const [createKind, setCreateKind] = useState<"drawing" | "folder" | null>(
    null,
  );
  const [createParent, setCreateParent] = useState<string>("");
  const [createName, setCreateName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const [renameTarget, setRenameTarget] = useState<VaultEntry | null>(null);
  const [moveTarget, setMoveTarget] = useState<VaultEntry | null>(null);
  // The move dialog lists every folder: it needs the vault file list.
  useEffect(() => {
    if (moveTarget) {
      onNeedIndex?.();
    }
  }, [moveTarget, onNeedIndex]);
  const [trashTarget, setTrashTarget] = useState<VaultEntry | null>(null);
  const [menu, setMenu] = useState<RowMenuState | null>(null);
  const [sortMenu, setSortMenu] = useState<{ x: number; y: number } | null>(
    null,
  );

  // Trash now, or ask first when confirmation is on.
  const requestTrash = (entry: VaultEntry) => {
    if (confirmDelete) {
      setTrashTarget(entry);
    } else {
      void onTrashEntry(entry.path);
    }
  };

  const treeId = useId();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  useEffect(() => {
    const win = asideRef.current?.ownerDocument.defaultView;
    setWidth(clampWidth(getPreferences(win).navigatorWidth));
  }, []);

  // Obsidian-style drag-to-resize; the navigator sits on the right edge.
  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const aside = asideRef.current;
    const win = aside?.ownerDocument.defaultView;
    if (!aside || !win) {
      return;
    }
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = aside.getBoundingClientRect().width;
    let next = startWidth;
    aside.classList.add("vault-navigator--resizing");
    const onMove = (e: PointerEvent) => {
      next = clampWidth(startWidth + (startX - e.clientX));
      setWidth(next);
    };
    const onUp = () => {
      win.removeEventListener("pointermove", onMove);
      win.removeEventListener("pointerup", onUp);
      aside.classList.remove("vault-navigator--resizing");
      updatePreferences({ navigatorWidth: next }, win);
    };
    win.addEventListener("pointermove", onMove);
    win.addEventListener("pointerup", onUp);
  };
  const treeContainerRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);

  // Names already in a folder, from the loaded tree plus the search index.
  const namesInFolder = (folder: string): string[] => {
    onNeedIndex?.();
    const names = allIndexedEntries
      .filter((e) => getParentPath(e.path) === folder)
      .map((e) => e.name);
    const find = (nodes: TreeNode[]): TreeNode[] | undefined => {
      for (const node of nodes) {
        if (node.entry.path === folder) {
          return node.children;
        }
        if (node.children && folder.startsWith(`${node.entry.path}/`)) {
          return find(node.children);
        }
      }
      return undefined;
    };
    const children = folder === "" ? treeNodes : find(treeNodes);
    return names.concat((children ?? []).map((c) => c.entry.name));
  };

  const { drag, onRowPointerDown, pointerRef } = useTreeDrag({
    containerRef: treeContainerRef,
    ghostRef,
    enabled: !vault.readOnly && !searchQuery.trim(),
    check: (source, folder) =>
      checkTreeDrop(source, folder, {
        readOnly: vault.readOnly,
        existingNames: namesInFolder(folder),
      }),
    onDrop: (source, folder) => void onMoveEntry(source.path, folder),
    isExpanded: (folder) => expandedFolders.has(folder),
    onExpandFolder,
  });

  // Collect all known folders for move destination picker
  const allFolderPaths = useMemo(
    () =>
      Array.from(
        new Set([
          "",
          ...allIndexedEntries
            .filter((e) => e.kind === "folder")
            .map((e) => e.path),
        ]),
      ),
    [allIndexedEntries],
  );

  const isSearching = searchQuery.trim() !== "";
  // Without native search, name matches come from the vault file list. With
  // it, only folder matches do: they fill in once the list has loaded, and a
  // search does not start the folder walk while the index answers it.
  useEffect(() => {
    if (isSearching && !search) {
      onNeedIndex?.();
    }
  }, [isSearching, search, onNeedIndex]);
  const tagSource = tagSearch === undefined ? search : tagSearch;
  const { tags, byPath: tagsByPath } = useVaultTags(tagSource, vault.handle);
  const filterByTag = (key: string) => setSearchQuery(tagQuery(key));
  const tagsPanelRef = useRef<TagsPanelHandle>(null);
  // Palette "Tag: #x" entries, the dock chips and a focus command reach the
  // navigator through these slots (nothing runs until they are called).
  const navLive = useRef({ collapsed, onToggleCollapse });
  navLive.current = { collapsed, onToggleCollapse };
  /** Expand the navigator if it is collapsed (tags, focus tree). */
  const showNavigator = useCallback(() => {
    if (navLive.current.collapsed) {
      navLive.current.onToggleCollapse();
    }
  }, []);
  useEffect(() => {
    const expand = showNavigator;
    const unActions = registerTagActions({
      filter: (key) => {
        expand();
        setSearchQuery(tagQuery(key));
      },
      focusPane: () => {
        expand();
        setTimeout(() => tagsPanelRef.current?.focus(), 0);
      },
    });
    const unPalette = registerPaletteProvider(
      createTagsProvider({
        tags: tagStore.get,
        apply: (key) => {
          expand();
          setSearchQuery(tagQuery(key));
        },
      }),
    );
    return () => {
      unActions();
      unPalette();
    };
  }, [showNavigator]);
  // Keep the panel during a plain tag filter so the active tag can be toggled off.
  const isTagFilter = tags.some((t) => tagQuery(t.tag) === searchQuery.trim());

  useEffect(() => {
    if (searchFocusNonce > 0) {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }
  }, [searchFocusNonce]);

  useEffect(() => {
    if (!request) {
      return;
    }
    if (request.kind === "search") {
      setSearchQuery(request.query);
      searchInputRef.current?.focus();
      return;
    }
    if (request.kind === "reveal") {
      setSearchQuery("");
      setFocusedPath(request.path);
      return;
    }
    if (request.kind === "newFolder") {
      setCreateParent("");
      setCreateKind("folder");
      setCreateName("");
      setCreateError(null);
      return;
    }
    if (request.kind === "newDrawingInFolder") {
      // The focused folder, else the focused row's (or open drawing's) folder.
      onRowNewInside(
        targetFolder(
          focusedPath ?? activePath,
          (p) => rows.find((r) => r.entry.path === p)?.entry.kind === "folder",
        ),
        "drawing",
      );
      return;
    }
    const entry = allIndexedEntries.find((e) => e.path === request.path) ?? {
      path: request.path,
      name: request.path.split("/").pop() ?? request.path,
      kind: "drawing" as const,
      modifiedAt: 0,
      size: 0,
    };
    if (request.kind === "rename") {
      setRenameTarget(entry);
    } else if (request.kind === "move") {
      setMoveTarget(entry);
    } else {
      requestTrash(entry);
    }
    // Only a new request (nonce) triggers; the other values are read live.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.nonce]);

  // Visible rows in display order: keyboard navigation and windowing.
  const rows = useMemo(
    () => flattenTree(treeNodes, expandedFolders),
    [treeNodes, expandedFolders],
  );
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const treeWindow = useTreeWindow(treeContainerRef, rows.length, !isSearching);
  const { scrollToRow } = treeWindow;
  // Keyboard focus moves between rows that may be outside the mounted window.
  useEffect(() => {
    if (focusedPath) {
      scrollToRow(rows.findIndex((r) => r.entry.path === focusedPath));
    }
  }, [focusedPath, rows, scrollToRow]);

  // Row handlers keep one identity so memoised rows skip unrelated renders.
  const live = useRef({
    onOpenDrawing,
    onOpenNote,
    onToggleFolder,
    onSyncAction,
  });
  live.current = { onOpenDrawing, onOpenNote, onToggleFolder, onSyncAction };
  /** Opens a file row by its kind: drawings and Obsidian Excalidraw files as drawings, notes via the notes hook. */
  const openEntry = useCallback(
    (path: string, kind: EntryKind, newTab?: boolean) => {
      const opts = newTab ? { target: "new" as const } : undefined;
      if (kind === "note") {
        void live.current.onOpenNote?.(path, opts);
      } else {
        void live.current.onOpenDrawing(path, opts);
      }
    },
    [],
  );
  const onRowSelect = useCallback(
    (path: string, kind: EntryKind, newTab?: boolean) => {
      setFocusedPath(path);
      const entry = rowsRef.current.find((r) => r.entry.path === path)?.entry;
      if (kind === "folder") {
        live.current.onToggleFolder(path);
      } else if (entry?.sync === "placeholder" && live.current.onSyncAction) {
        live.current.onSyncAction(entry, "open");
      } else {
        openEntry(path, kind, newTab);
      }
    },
    [openEntry],
  );
  const onRowToggle = useCallback(
    (path: string) => live.current.onToggleFolder(path),
    [],
  );
  const onRowNewInside = useCallback(
    (folderPath: string, kind: "folder" | "drawing") => {
      setCreateParent(folderPath);
      setCreateKind(kind);
      setCreateName("");
      setCreateError(null);
    },
    [],
  );
  const onRowMenu = useCallback(
    (entry: VaultEntry, x: number, y: number) => setMenu({ entry, x, y }),
    [],
  );

  // Tree keys are `list.*` commands (rebindable in [hotkeys]). The controller
  // is stable and computes actions from this snapshot only on demand.
  const openRow = useCallback(
    (path: string, newTab: boolean) => {
      const entry = rowsRef.current.find((r) => r.entry.path === path)?.entry;
      if (entry?.sync === "placeholder" && live.current.onSyncAction) {
        live.current.onSyncAction(entry, "open");
        return;
      }
      openEntry(path, entry?.kind ?? "drawing", newTab);
    },
    [openEntry],
  );
  const openRowMenu = useCallback(
    (entry: VaultEntry) => {
      const rowEl = treeContainerRef.current?.querySelector<HTMLElement>(
        `[data-tree-path="${CSS.escape(entry.path)}"]`,
      );
      const box = rowEl?.getBoundingClientRect();
      if (box) {
        onRowMenu(entry, box.left + 40, box.bottom);
      }
    },
    [onRowMenu],
  );
  const exitTree = useCallback(() => {
    treeContainerRef.current?.blur();
    focusCanvasIfIdle(treeContainerRef.current?.ownerDocument);
  }, []);
  const treeState = useRef<TreeKeyDeps | null>(null);
  treeState.current = {
    rows,
    focusedPath,
    activePath,
    readOnly: vault.readOnly,
    dragging: !!drag,
    setFocusedPath,
    expand: onExpandFolder,
    toggle: onToggleFolder,
    open: openRow,
    rename: setRenameTarget,
    trash: requestTrash,
    move: setMoveTarget,
    create: onRowNewInside,
    menu: openRowMenu,
    exit: exitTree,
    // command audit (S8): the row menu's items as list.* commands
    row: {
      duplicate: (path) => void onDuplicateDrawing(path),
      reveal: (path) => void onRevealEntry(path),
      // The Gallery plugin's menu item, run for the focused folder; absent while the plugin is off.
      showAsGrid: (path) => {
        const item = getMenuItems("tree").find(
          (i) => i.command === "gallery.show-folder",
        );
        if (item) {
          runMenuItem(item, { surface: "tree", path, kind: "folder" });
        }
      },
      saveAsTemplate: onSaveAsTemplate,
      localGraph: onOpenLocalGraph && ((path) => void onOpenLocalGraph(path)),
      history: onShowHistory && ((path) => void onShowHistory(path)),
      export:
        onExportDrawing &&
        ((path, format) => void onExportDrawing(path, format)),
    },
  };
  const treeKeys = useMemo(() => lazyTreeController(treeState), []);
  useListKeys(treeContainerRef, "tree", isSearching ? null : treeKeys);

  // "Focus file tree" (navigator.focusTree): show the tree and focus it; from
  // the tree, back to the canvas (a toggle, like Zed's project panel). The
  // request is consumed once, so later search or collapse changes never
  // pull focus into the tree.
  const focusTreePending = useRef(false);
  const [focusTreeNonce, setFocusTreeNonce] = useState(0);
  useEffect(
    () =>
      registerCommandHandlers({
        [FOCUS_TREE_COMMAND_ID]: () => {
          const el = treeContainerRef.current;
          if (el?.contains(el.ownerDocument.activeElement)) {
            exitTree();
            return;
          }
          showNavigator();
          setSearchQuery("");
          focusTreePending.current = true;
          setFocusTreeNonce((n) => n + 1);
        },
      }),
    [exitTree, showNavigator],
  );
  // Offered only while there is a query to clear (command audit S8).
  const hasQuery = searchQuery !== "";
  useEffect(
    () =>
      hasQuery
        ? registerCommandHandlers({
            [CLEAR_SEARCH_COMMAND_ID]: () => setSearchQuery(""),
          })
        : undefined,
    [hasQuery],
  );
  useEffect(() => {
    if (focusTreePending.current && !collapsed && !isSearching) {
      focusTreePending.current = false;
      focusList("tree");
    }
  }, [focusTreeNonce, collapsed, isSearching]);

  // Create submission
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createKind || !createName.trim()) {
      return;
    }
    setCreateError(null);
    try {
      if (createKind === "drawing") {
        const fullDrawingName = createName.trim().endsWith(".excalidraw")
          ? createName.trim()
          : `${createName.trim()}.excalidraw`;
        await onCreateDrawing(createParent, fullDrawingName);
      } else {
        await onCreateFolder(createParent, createName.trim());
      }
      setCreateKind(null);
      setCreateName("");
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <aside
      ref={asideRef}
      className={`vault-navigator ${
        collapsed ? "vault-navigator--collapsed" : ""
      }`}
      style={collapsed ? undefined : { width, flexBasis: width }}
      aria-label="Vault File Navigator"
      // Its dialogs render inside: keep them visible to assistive tech when
      // the palette opens one with the navigator collapsed.
      aria-hidden={
        collapsed && !createKind && !renameTarget && !moveTarget && !trashTarget
      }
      data-vault-path={vault.path}
    >
      {!collapsed && (
        <div
          className="vault-navigator__resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize navigator"
          onPointerDown={startResize}
          onDoubleClick={() => {
            setWidth(DEFAULT_WIDTH);
            updatePreferences(
              { navigatorWidth: DEFAULT_WIDTH },
              asideRef.current?.ownerDocument.defaultView,
            );
          }}
        />
      )}
      <div className="vault-navigator__toolbar">
        {!vault.readOnly && (
          <>
            <button
              type="button"
              className="vault-btn vault-btn--ghost vault-btn--icon"
              onClick={() => {
                setCreateParent("");
                setCreateKind("drawing");
                setCreateName("");
                setCreateError(null);
              }}
              title="New drawing"
              aria-label="New Drawing"
            >
              <IconNewDrawing />
            </button>
            <button
              type="button"
              className="vault-btn vault-btn--ghost vault-btn--icon"
              onClick={() => {
                setCreateParent("");
                setCreateKind("folder");
                setCreateName("");
                setCreateError(null);
              }}
              title="New folder"
              aria-label="New Folder"
            >
              <IconFolderPlus />
            </button>
          </>
        )}
        {onRefresh && (
          <button
            type="button"
            className="vault-btn vault-btn--ghost vault-btn--icon"
            onClick={onRefresh}
            title="Refresh files"
            aria-label="Refresh files"
          >
            <IconRefresh />
          </button>
        )}
        <button
          type="button"
          className="vault-btn vault-btn--ghost vault-btn--icon"
          onClick={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            setSortMenu({ x: box.right, y: box.bottom + 4 });
          }}
          title="Sort order"
          aria-label="Sort order"
          aria-haspopup="menu"
        >
          <IconSort />
        </button>
        {onOpenGraph && (
          <GraphViewButton
            onClick={onOpenGraph}
            pressed={graphOpen}
            win={ownerDocument?.defaultView ?? null}
          />
        )}
      </div>

      {/* Search Input */}
      <div className="vault-search">
        <div className="vault-search__box">
          <IconSearch />
          <input
            ref={searchInputRef}
            type="text"
            className="vault-search__input"
            placeholder="Search drawings and text… (tag:#name)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                // First Escape clears the query, the next one leaves the box.
                if (searchQuery) {
                  setSearchQuery("");
                } else {
                  e.currentTarget.blur();
                }
              }
            }}
          />
          {isIndexing && (
            <span className="vault-spinner" title="Indexing files..." />
          )}
          {searchQuery && (
            <button
              type="button"
              className="vault-search__clear"
              onClick={() => setSearchQuery("")}
              aria-label="Clear search"
            >
              <IconClose />
            </button>
          )}
        </div>
      </div>

      {tagSearch !== null && (!isSearching || isTagFilter) && (
        <TagsPanel
          ref={tagsPanelRef}
          key={vault.path}
          vaultKey={vault.path}
          tags={tags}
          query={searchQuery}
          onQueryChange={setSearchQuery}
          defaultSort={tagsDefaultSort}
          onRenameTag={onRenameTag}
          onExit={() => treeContainerRef.current?.focus()}
        />
      )}

      {/* Search Results or Tree View */}
      <div
        ref={treeContainerRef}
        className={`vault-tree-container ${
          drag?.targetFolder === "" ? "vault-tree-container--drop-root" : ""
        }`}
        role={isSearching ? undefined : "tree"}
        id={treeId}
        tabIndex={isSearching ? undefined : 0}
      >
        {isSearching ? (
          <SearchResults
            query={searchQuery.trim()}
            inputRef={searchInputRef}
            // Tag filters (`tag:#x`) use the tags source even with full-text
            // search off (`extensions.search`).
            search={
              search ??
              (searchQuery.trim().startsWith("tag:#") ? tagSource : null)
            }
            handle={vault.handle}
            allIndexedEntries={allIndexedEntries}
            activePath={activePath}
            onOpenDrawing={(path, opts) =>
              void (onOpenSearchResult
                ? onOpenSearchResult(path, undefined, opts)
                : onOpenDrawing(path, opts))
            }
            onOpenMatch={(path, match, opts) =>
              void (onOpenSearchResult
                ? onOpenSearchResult(path, match, opts)
                : onOpenDrawing(path, opts))
            }
            onOpenFolder={(path) => {
              onExpandFolder(path);
              setSearchQuery("");
            }}
          />
        ) : (
          <div className="vault-tree-body">
            {treeNodes.length === 0 ? (
              <div className="vault-tree-empty">
                Vault is empty. Create your first drawing!
              </div>
            ) : (
              <TreeRows
                rows={rows}
                start={treeWindow.start}
                end={treeWindow.end}
                activePath={activePath}
                focusedPath={focusedPath}
                readOnly={vault.readOnly}
                onSelect={onRowSelect}
                onToggleFolder={onRowToggle}
                onNewInside={onRowNewInside}
                onOpenMenu={onRowMenu}
                onRowPointerDown={onRowPointerDown}
                dropTarget={drag?.allowed ? drag.targetFolder : null}
                dragSourcePath={drag?.source.path ?? null}
                tagsByPath={showTagChips ? tagsByPath : undefined}
                onFilterTag={filterByTag}
              />
            )}
            {/* Empty space below the rows: dropping here moves to the root. */}
            <div className="vault-tree-root-drop" aria-hidden="true">
              {drag && drag.targetFolder === "" && drag.allowed && (
                <span>Move to vault root</span>
              )}
            </div>
          </div>
        )}
      </div>

      {dockSlot}

      {/* Vault switcher and settings (Obsidian-style footer) */}
      <div className="vault-navigator__footer">
        <button
          type="button"
          className="vault-navigator__vault"
          onClick={() => void onSwitchVault()}
          title={`${vault.path}\nClick to open another vault`}
          aria-label="Close current vault and open another"
        >
          <span className="vault-navigator__vault-name">{vault.name}</span>
          <IconChevronsUpDown />
        </button>
        {onOpenSettings && (
          <button
            type="button"
            className="vault-btn vault-btn--ghost vault-btn--icon"
            onClick={onOpenSettings}
            title="Settings"
            aria-label="Settings"
          >
            <IconSettings />
          </button>
        )}
      </div>

      {drag &&
        createPortal(
          <div
            ref={ghostRef}
            className="vault-tree-drag-ghost"
            data-allowed={drag.allowed ? "true" : "false"}
            style={{
              transform: ghostTransform(
                pointerRef.current.x,
                pointerRef.current.y,
              ),
            }}
            role="status"
            aria-live="polite"
          >
            <span className="vault-tree-drag-ghost__name">
              {drag.source.kind === "folder" ? <IconFolder /> : <IconDrawing />}
              {stripDrawingExt(drag.source.name)}
            </span>
            {drag.targetFolder !== null && (
              <span className="vault-tree-drag-ghost__hint">
                {drag.allowed
                  ? `Move to ${
                      drag.targetFolder
                        ? drag.targetFolder.split("/").pop()
                        : "vault root"
                    }`
                  : drag.reason}
              </span>
            )}
          </div>,
          (asideRef.current?.ownerDocument ?? ownerDocument ?? document).body,
        )}

      {sortMenu && (
        <MenuPopup
          x={sortMenu.x}
          y={sortMenu.y}
          label="Sort order"
          ownerDocument={asideRef.current?.ownerDocument ?? ownerDocument}
          onClose={() => setSortMenu(null)}
        >
          {SORT_ORDERS.map((order) => (
            <MenuItem
              key={order}
              label={SORT_LABELS[order]}
              checked={order === sortOrder}
              onSelect={() => {
                setSortMenu(null);
                onSortChange(order);
              }}
            />
          ))}
        </MenuPopup>
      )}

      {menu && (
        <RowMenu
          state={menu}
          readOnly={vault.readOnly}
          ownerDocument={asideRef.current?.ownerDocument ?? ownerDocument}
          onClose={() => setMenu(null)}
          onNewInside={onRowNewInside}
          onDuplicate={(entry) => void onDuplicateDrawing(entry.path)}
          onSaveAsTemplate={
            onSaveAsTemplate && ((entry) => onSaveAsTemplate(entry.path))
          }
          onRename={(entry) => setRenameTarget(entry)}
          onMove={(entry) => setMoveTarget(entry)}
          onReveal={(entry) => void onRevealEntry(entry.path)}
          onExport={
            onExportDrawing &&
            ((entry, format) => void onExportDrawing(entry.path, format))
          }
          onTrash={requestTrash}
          onOpenLocalGraph={
            onOpenLocalGraph && ((entry) => void onOpenLocalGraph(entry.path))
          }
          onSyncAction={onSyncAction}
          onShowHistory={
            onShowHistory && ((entry) => void onShowHistory(entry.path))
          }
        />
      )}

      {/* Create Modal */}
      {createKind && (
        <Dialog
          title={`New ${createKind === "drawing" ? "Drawing" : "Folder"}${
            createParent ? ` in /${createParent}` : ""
          }`}
          titleId="create-entry-title"
          onClose={() => setCreateKind(null)}
          onSubmit={handleCreateSubmit}
          footer={
            <>
              <button
                type="button"
                className="vault-btn"
                onClick={() => setCreateKind(null)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="vault-btn vault-btn--primary"
                disabled={!createName.trim()}
              >
                Create
              </button>
            </>
          }
        >
          <div className="vault-field">
            <label htmlFor="create-entry-name">Name</label>
            <input
              id="create-entry-name"
              type="text"
              className="vault-input"
              autoFocus
              value={createName}
              onChange={(e) => {
                setCreateName(e.target.value);
                if (createError) {
                  setCreateError(null);
                }
              }}
              placeholder={
                createKind === "drawing" ? "My Drawing" : "Folder Name"
              }
            />
            {createKind === "drawing" && (
              <span className="vd-dialog__hint">
                Extension .excalidraw will be added automatically
              </span>
            )}
            {createError && (
              <div className="vault-error-text">{createError}</div>
            )}
          </div>
        </Dialog>
      )}

      {/* Rename Modal */}
      {renameTarget && (
        <RenameModal
          initialName={renameTarget.name}
          kind={renameTarget.kind === "folder" ? "folder" : "drawing"}
          onRename={async (newName) => {
            await onRenameEntry(renameTarget.path, newName);
            setRenameTarget(null);
          }}
          onCancel={() => setRenameTarget(null)}
        />
      )}

      {/* Move Modal */}
      {moveTarget && (
        <MoveModal
          sourcePath={moveTarget.path}
          sourceKind={moveTarget.kind === "folder" ? "folder" : "drawing"}
          folders={allFolderPaths}
          onMove={async (destFolder) => {
            await onMoveEntry(moveTarget.path, destFolder);
            setMoveTarget(null);
          }}
          onCancel={() => setMoveTarget(null)}
        />
      )}

      {/* Trash Confirm Modal */}
      {trashTarget && (
        <ConfirmModal
          title={`Delete ${
            trashTarget.kind === "drawing" ? "Drawing" : "Folder"
          }`}
          message={
            trashTarget.kind === "folder"
              ? `Move the folder “${trashTarget.name}” to the trash? You can restore it from the system Trash. Only empty folders can be trashed, so move or delete its drawings first.`
              : `Move “${trashTarget.name}” to the trash? You can restore it from the system Trash.`
          }
          confirmLabel="Move to Trash"
          isDanger
          onConfirm={async () => {
            await onTrashEntry(trashTarget.path);
            setTrashTarget(null);
          }}
          onCancel={() => setTrashTarget(null)}
        />
      )}
    </aside>
  );
};

interface TreeRowsProps {
  rows: TreeRowData[];
  /** Rows [start, end) are mounted; spacers stand in for the rest. */
  start: number;
  end: number;
  activePath: string | null;
  focusedPath: string | null;
  readOnly: boolean;
  onSelect: (path: string, kind: EntryKind, newTab?: boolean) => void;
  onToggleFolder: (path: string) => void;
  onNewInside: (folderPath: string, kind: "folder" | "drawing") => void;
  onOpenMenu: (entry: VaultEntry, x: number, y: number) => void;
  onRowPointerDown: (
    event: React.PointerEvent<HTMLElement>,
    entry: DragSource,
  ) => void;
  /** Folder highlighted as the drop target (only while a drop is allowed). */
  dropTarget: string | null;
  dragSourcePath: string | null;
  /** Tags per drawing path; undefined hides the chips. */
  tagsByPath?: Record<string, string[]>;
  onFilterTag: (key: string) => void;
}

const TreeRows = ({
  rows,
  start,
  end,
  activePath,
  focusedPath,
  dropTarget,
  dragSourcePath,
  tagsByPath,
  ...handlers
}: TreeRowsProps) => (
  <>
    {start > 0 && (
      <div
        aria-hidden="true"
        style={{ height: start * TREE_ROW_HEIGHT, flexShrink: 0 }}
      />
    )}
    {rows.slice(start, end).map((row) => {
      const path = row.entry.path;
      const isFolder = row.entry.kind === "folder";
      return (
        <TreeRow
          key={path}
          entry={row.entry}
          depth={row.depth}
          expanded={row.expanded}
          active={path === activePath}
          focused={path === focusedPath}
          dropTarget={isFolder && dropTarget === path}
          dragSource={dragSourcePath === path}
          tags={isFolder ? undefined : tagsByPath?.[path]}
          {...handlers}
        />
      );
    })}
    {end < rows.length && (
      <div
        aria-hidden="true"
        style={{ height: (rows.length - end) * TREE_ROW_HEIGHT, flexShrink: 0 }}
      />
    )}
  </>
);

interface TreeRowProps
  extends Pick<
    TreeRowsProps,
    | "readOnly"
    | "onSelect"
    | "onToggleFolder"
    | "onNewInside"
    | "onOpenMenu"
    | "onRowPointerDown"
    | "onFilterTag"
  > {
  entry: VaultEntry;
  depth: number;
  expanded: boolean;
  active: boolean;
  focused: boolean;
  dropTarget: boolean;
  dragSource: boolean;
  tags?: string[];
}

const TreeRow = memo(
  ({
    entry,
    depth,
    expanded: isExpanded,
    active: isActive,
    focused: isFocused,
    dropTarget: isDropTarget,
    dragSource: isDragSource,
    tags,
    readOnly,
    onSelect,
    onToggleFolder,
    onNewInside,
    onOpenMenu,
    onRowPointerDown,
    onFilterTag,
  }: TreeRowProps) => {
    const [hovered, setHovered] = useState(false);
    const [focusWithin, setFocusWithin] = useState(false);
    const isFolder = entry.kind === "folder";
    // Row actions mount only while hovered, focused or active (CSS still reveals them).
    const showActions = hovered || focusWithin || isFocused || isActive;
    return (
      <div
        className={`vault-tree-item ${
          isActive ? "vault-tree-item--active" : ""
        } ${isFocused ? "vault-tree-item--focused" : ""} ${
          isDropTarget ? "vault-tree-item--drop-target" : ""
        } ${isDragSource ? "vault-tree-item--drag-source" : ""}`}
        style={{ "--depth": depth } as React.CSSProperties}
        data-tree-path={entry.path}
        data-tree-kind={entry.kind}
        onPointerDown={(e) => {
          if (isFolder || entry.kind === "drawing") {
            onRowPointerDown(e, entry);
          }
        }}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onFocus={() => setFocusWithin(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setFocusWithin(false);
          }
        }}
        role="treeitem"
        aria-expanded={isFolder ? isExpanded : undefined}
        aria-selected={isActive}
        tabIndex={isFocused ? 0 : -1}
        onClick={(e) => onSelect(entry.path, entry.kind, isNewTabClick(e))}
        onAuxClick={(e) => {
          // Middle click opens a drawing in a new tab.
          if (e.button === 1 && !isFolder) {
            e.preventDefault();
            onSelect(entry.path, entry.kind, true);
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          onOpenMenu(entry, e.clientX, e.clientY);
        }}
      >
        <div className="vault-tree-item__main">
          {isFolder ? (
            <span
              className="vault-tree-item__toggle"
              onClick={(e) => {
                e.stopPropagation();
                onToggleFolder(entry.path);
              }}
              aria-label={isExpanded ? "Collapse" : "Expand"}
            >
              {isExpanded ? <IconChevronDown /> : <IconChevronRight />}
            </span>
          ) : (
            <span className="vault-tree-item__icon">
              {entry.kind === "note" ? <IconNote /> : <IconDrawing />}
            </span>
          )}

          <span className="vault-tree-item__name" title={entry.path}>
            {isFolder ? entry.name : entryDisplayName(entry.name)}
          </span>
          {entry.sync && <SyncBadge sync={entry.sync} />}
          {tags && <TagChips tags={tags} onFilter={onFilterTag} />}
        </div>

        {showActions && (
          <div
            className="vault-tree-item__actions"
            onClick={(e) => e.stopPropagation()}
          >
            {isFolder && !readOnly && (
              <button
                type="button"
                className="vault-tree-action-btn"
                title="New drawing in this folder"
                onClick={() => onNewInside(entry.path, "drawing")}
                aria-label="New drawing in folder"
              >
                <IconPlus />
              </button>
            )}
            <button
              type="button"
              className="vault-tree-action-btn"
              title="More actions"
              aria-label="More actions"
              aria-haspopup="menu"
              onClick={(e) => {
                const box = e.currentTarget.getBoundingClientRect();
                onOpenMenu(entry, box.right, box.bottom + 4);
              }}
            >
              <IconMore />
            </button>
          </div>
        )}
      </div>
    );
  },
);

interface RowMenuState {
  entry: VaultEntry;
  x: number;
  y: number;
}

interface RowMenuProps {
  state: RowMenuState;
  readOnly: boolean;
  ownerDocument?: Document | null;
  onClose: () => void;
  onNewInside: (folderPath: string, kind: "folder" | "drawing") => void;
  onDuplicate: (entry: VaultEntry) => void;
  onSaveAsTemplate?: (entry: VaultEntry) => void;
  onRename: (entry: VaultEntry) => void;
  onMove: (entry: VaultEntry) => void;
  onReveal: (entry: VaultEntry) => void;
  onExport?: (entry: VaultEntry, format: ExplorerExportFormat) => void;
  onTrash: (entry: VaultEntry) => void;
  onOpenLocalGraph?: (entry: VaultEntry) => void;
  onShowHistory?: (entry: VaultEntry) => void;
  onSyncAction?: (entry: VaultEntry, action: "compare" | "download") => void;
}

const MENU_WIDTH = 200;

interface MenuPopupProps {
  x: number;
  y: number;
  label: string;
  ownerDocument?: Document | null;
  onClose: () => void;
  children: ReactNode;
}

/** Positioned `vault-menu` with focus, arrow-key and dismiss handling. */
const MenuPopup = ({
  x,
  y,
  label,
  ownerDocument,
  onClose,
  children,
}: MenuPopupProps) => {
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const doc = menuRef.current?.ownerDocument ?? ownerDocument;
    const win = doc?.defaultView;
    if (!doc || !win) {
      return;
    }
    menuRef.current
      ?.querySelector<HTMLButtonElement>("[role^='menuitem']")
      ?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
        return;
      }
      event.preventDefault();
      const items = Array.from(
        menuRef.current?.querySelectorAll<HTMLButtonElement>(
          "[role^='menuitem']",
        ) ?? [],
      );
      const index = items.indexOf(doc.activeElement as HTMLButtonElement);
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
    };
    doc.addEventListener("pointerdown", onPointerDown, true);
    doc.addEventListener("keydown", onKeyDown, true);
    win.addEventListener("blur", onClose);
    win.addEventListener("resize", onClose);
    return () => {
      doc.removeEventListener("pointerdown", onPointerDown, true);
      doc.removeEventListener("keydown", onKeyDown, true);
      win.removeEventListener("blur", onClose);
      win.removeEventListener("resize", onClose);
    };
  }, [onClose, ownerDocument]);

  const win = ownerDocument?.defaultView;
  const maxX = (win?.innerWidth ?? 1280) - MENU_WIDTH - 8;
  const maxY = (win?.innerHeight ?? 800) - 220;
  const left = Math.max(8, Math.min(x - MENU_WIDTH, maxX));
  const top = Math.max(8, Math.min(y, maxY));

  return (
    <div
      ref={menuRef}
      className="vault-menu"
      role="menu"
      aria-label={label}
      style={{ left, top, width: MENU_WIDTH }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </div>
  );
};

interface MenuItemProps {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  checked?: boolean;
  onSelect: () => void;
}

const MenuItem = ({
  label,
  icon,
  danger,
  checked,
  onSelect,
}: MenuItemProps) => (
  <button
    type="button"
    role={checked === undefined ? "menuitem" : "menuitemradio"}
    aria-checked={checked}
    className={`vault-menu__item ${danger ? "vault-menu__item--danger" : ""}`}
    onClick={onSelect}
  >
    {icon}
    <span>{label}</span>
    {checked && <IconCheck className="vault-menu__check" />}
  </button>
);

/** Row actions shown from the "More actions" button or a right-click. */
const RowMenu = ({
  state,
  readOnly,
  ownerDocument,
  onClose,
  onNewInside,
  onDuplicate,
  onSaveAsTemplate,
  onRename,
  onMove,
  onReveal,
  onExport,
  onTrash,
  onOpenLocalGraph,
  onShowHistory,
  onSyncAction,
}: RowMenuProps) => {
  const { entry } = state;
  const isFolder = entry.kind === "folder";
  // Notes and Obsidian Excalidraw files only offer "Reveal" from the tree (no edits, no exports).
  const isDrawing = entry.kind === "drawing";

  const item = (
    label: string,
    icon: ReactNode,
    action: () => void,
    danger = false,
  ) => (
    <MenuItem
      label={label}
      icon={icon}
      danger={danger}
      onSelect={() => {
        onClose();
        action();
      }}
    />
  );

  // Items plugins declared for tree rows (`[[contributes.menus]]`), filtered by the row's kind.
  const rowKind = isFolder ? "folder" : isDrawing ? "drawing" : "note";
  const pluginItems = getMenuItems("tree").filter(
    (it) => it.kinds.length === 0 || it.kinds.includes(rowKind),
  );

  return (
    <MenuPopup
      x={state.x}
      y={state.y}
      label={`Actions for ${entry.name}`}
      ownerDocument={ownerDocument}
      onClose={onClose}
    >
      {isFolder && !readOnly && (
        <>
          {item("New drawing here", <IconNewDrawing />, () =>
            onNewInside(entry.path, "drawing"),
          )}
          {item("New folder here", <IconFolderPlus />, () =>
            onNewInside(entry.path, "folder"),
          )}
        </>
      )}
      {isDrawing &&
        !readOnly &&
        item("Duplicate", <IconCopy />, () => onDuplicate(entry))}
      {isDrawing &&
        onSaveAsTemplate &&
        item("Save as template…", <IconTemplate />, () =>
          onSaveAsTemplate(entry),
        )}
      {!readOnly &&
        (isFolder || isDrawing) &&
        item("Rename", <IconEdit />, () => onRename(entry))}
      {!readOnly &&
        (isFolder || isDrawing) &&
        item("Move to…", <IconMove />, () => onMove(entry))}
      {item("Reveal in file manager", <IconReveal />, () => onReveal(entry))}
      {isDrawing &&
        onOpenLocalGraph &&
        item("Open local graph", <IconGraph />, () => onOpenLocalGraph(entry))}
      {isDrawing &&
        onShowHistory &&
        item("History", <IconHistory />, () => onShowHistory(entry))}
      {isDrawing &&
        entry.sync === "conflict" &&
        onSyncAction &&
        item("Compare with original…", <IconCopy />, () =>
          onSyncAction(entry, "compare"),
        )}
      {entry.sync === "placeholder" &&
        onSyncAction &&
        item("Download from iCloud", <IconReveal />, () =>
          onSyncAction(entry, "download"),
        )}
      {isDrawing && onExport && (
        <>
          <div className="vault-menu__separator" role="separator" />
          {item("Export as PNG…", <IconExportImage />, () =>
            onExport(entry, "png"),
          )}
          {item("Export as SVG…", <IconExportVector />, () =>
            onExport(entry, "svg"),
          )}
          {item("Export as PDF…", <IconExportDocument />, () =>
            onExport(entry, "pdf"),
          )}
          {item("Save a copy…", <IconSaveCopy />, () =>
            onExport(entry, "copy"),
          )}
        </>
      )}
      {!readOnly && (isFolder || isDrawing) && (
        <>
          <div className="vault-menu__separator" role="separator" />
          {item("Move to Trash", <IconTrash />, () => onTrash(entry), true)}
        </>
      )}
      {pluginItems.length > 0 && (
        <>
          <div className="vault-menu__separator" role="separator" />
          {pluginItems.map((it) => (
            <MenuItem
              key={it.command + it.title}
              label={it.title}
              icon={null}
              onSelect={() => {
                onClose();
                runMenuItem(it, {
                  surface: "tree",
                  path: entry.path,
                  kind:
                    entry.kind === "excalidrawMd"
                      ? "other"
                      : (rowKind as "drawing" | "note" | "folder"),
                });
              }}
            />
          ))}
        </>
      )}
    </MenuPopup>
  );
};

/** "conflict" or "not downloaded" next to a tree row's name. Mounted only for flagged rows. */
const SyncBadge = ({ sync }: { sync: "conflict" | "placeholder" }) => {
  const [showConflict] = useGlobalPref(undefined, "syncConflictBadge");
  if (sync === "conflict") {
    return showConflict ? (
      <span
        className="vault-tree-item__sync"
        data-testid="sync-conflict-badge"
        title="A sync service made this copy when two devices changed the same file. Use the row menu to compare."
      >
        conflict
      </span>
    ) : null;
  }
  return (
    <span
      className="vault-tree-item__sync vault-tree-item__sync--placeholder"
      data-testid="sync-placeholder-badge"
      title="iCloud has not downloaded this file yet."
    >
      not downloaded
    </span>
  );
};
