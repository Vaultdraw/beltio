/**
 * App-level links wiring for VaultApp: open/back/forward history, the dock,
 * "Create" for unresolved targets, the links-aware rename/move, the
 * links-rewrite-done toast, the re-measure set and the link commands that
 * need app state. Nothing here runs on the open or typing paths: the index is
 * only asked when a link is used, the dock is visible or a move happens.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ConfirmModal } from "../components/ConfirmModal";
import {
  drawingOpenCommandId,
  DRAWING_OPEN_PREFIX,
} from "../commands/drawingCommands";
import {
  registerCommandHandlers,
  registerCommandPrefixHandler,
} from "../commands/handlerRegistry";
import { getPreferences, updatePreferences } from "../vault/preferences";
import { setHotkeyOverride } from "../commands/useCommands";
import { ensureFolder, folderChain } from "../vault/newDrawing";
import { errorMessage } from "../vault/types";

import { createSpot } from "./createTarget";
import { getDockVisible, setDockVisible } from "./dockState";
import { linkTargetFor, wikiLink } from "./format";
import { NavHistories } from "./history";
import { decideMove, updatedMessage } from "./moveFlow";
import { toastRewriteDone } from "./rewriteToast";
import { createResolver } from "./resolve";

import type { LinksDockHandle } from "../components/links/LinksDock";
import type { EditorLinksBridge } from "../editor/links/useVaultEditorLinks";
import type { ConfirmRequest } from "./moveFlow";
import type {
  LinksSettings,
  MoveResult,
  RemeasureSet,
  VaultLinks,
} from "./types";
import type { OpenTarget } from "../tabs/types";
import type { VaultSearch } from "../search/types";
import type { VaultRepository, VaultEntry, VaultInfo } from "../vault/types";

export type AppLinksDeps = {
  links: VaultLinks | null;
  /**
   * `extensions.links`. Off: no dock, no link commands, no re-measure, no
   * names list. Rename/move still rewrites links per `links.update_on_rename`
   * (a core behaviour), and `drawing.open:` commands still work.
   */
  enabled?: boolean;
  search: Pick<VaultSearch, "subscribe"> | null;
  repository: VaultRepository;
  vault: VaultInfo | null;
  win: Window | null;
  doc: Document | null;
  settings: LinksSettings;
  entries: readonly VaultEntry[];
  indexing: boolean;
  activePath: string | null;
  navigatorCollapsed: boolean;
  /**
   * Open `path` (unless already open) and focus `elementId` when given.
   * `target` "new" opens a new tab; omitted = "current".
   */
  open(path: string, elementId?: string, target?: OpenTarget): Promise<void>;
  /** The active tab's id: back/forward history is per tab. Null/omitted: one shared history. */
  activeTabId?: string | null;
  /** Live read of the active tab id (the prop lags a render behind `open`). */
  getActiveTabId?(): string | null;
  /** Ids of the open tabs; histories of closed tabs are dropped on the next link open. */
  openTabIds?(): ReadonlySet<string>;
  /** Parent folder for a new drawing per files.new_drawing_folder. */
  prepareParent(): Promise<string | null>;
  createDrawing(parent: string, name: string): Promise<void>;
  loadDirectory(path: string): Promise<void>;
  expandFolder(path: string): void;
  showNavigator(): void;
  openHotkeys(): void;
  notify(message: string, type: "info" | "error"): void;
};

type PendingConfirm = ConfirmRequest & { resolve(ok: boolean): void };

const NO_NAMES: readonly string[] = [];

/** Sorted drawing paths of the vault entries. */
export const drawingNames = (entries: readonly VaultEntry[]): string[] =>
  entries
    .filter((e) => e.kind === "drawing")
    .map((e) => e.path)
    .sort();

/**
 * Drawing paths as a list whose identity changes only with its content.
 * Skipped (constant empty list) while `enabled` is false, so a vault without
 * a link index pays no filter+sort for every crawl batch.
 */
export function useStableNames(
  entries: readonly VaultEntry[],
  enabled: boolean,
) {
  const last = useRef<readonly string[]>(NO_NAMES);
  return useMemo(() => {
    if (!enabled) {
      return NO_NAMES;
    }
    const next = drawingNames(entries);
    const prev = last.current;
    if (prev.length === next.length && prev.every((p, i) => p === next[i])) {
      return prev;
    }
    last.current = next;
    return next;
  }, [entries, enabled]);
}

export function useAppLinks(deps: AppLinksDeps) {
  const live = useRef(deps);
  live.current = deps;
  const { links, vault, win } = deps;
  const enabled = deps.enabled ?? true;
  const handle = vault?.handle ?? null;
  const names = useStableNames(deps.entries, links !== null && enabled);
  const histories = useMemo(() => new NavHistories(), []);
  /** The active tab's history, read live (never stale across an await). */
  const activeHistory = useCallback(() => {
    const d = live.current;
    return histories.for(d.getActiveTabId ? d.getActiveTabId() : d.activeTabId);
  }, [histories]);
  const bridge = useRef<EditorLinksBridge | null>(null);
  const dockRef = useRef<LinksDockHandle | null>(null);

  const [dockPref, setDockVisibleState] = useState(() => getDockVisible(win));
  const dockVisible = enabled && dockPref;
  const [dockFocus, setDockFocus] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const [remeasureTick, setRemeasureTick] = useState(0);
  const remeasureSet = useRef<Map<string, string[]>>(new Map());

  const ask = useCallback(
    (request: ConfirmRequest) =>
      new Promise<boolean>((resolve) => {
        setConfirm({ ...request, resolve });
      }),
    [],
  );
  const answer = (ok: boolean) => {
    confirm?.resolve(ok);
    setConfirm(null);
  };

  // ---- navigation -------------------------------------------------------
  const syncCurrent = useCallback(() => {
    const path = live.current.activePath;
    if (path) {
      activeHistory().visit({ path });
    }
  }, [activeHistory]);

  const openLink = useCallback(
    async (
      path: string,
      elementId?: string,
      target: OpenTarget = "current",
    ) => {
      syncCurrent();
      const before = live.current.getActiveTabId?.() ?? null;
      await live.current.open(path, elementId, target);
      const d = live.current;
      const openTabs = d.openTabIds?.();
      if (openTabs) {
        histories.prune(openTabs);
      }
      // The visit belongs to the tab showing the link now: the new tab for
      // "new" (or a pinned current tab). A "new" open that did not move focus
      // (tabs.focus_new = false) is not recorded; the origin tab keeps its entry.
      if (
        target === "new" &&
        d.getActiveTabId &&
        d.getActiveTabId() === before
      ) {
        return;
      }
      activeHistory().visit({ path, elementId });
    },
    [histories, activeHistory, syncCurrent],
  );

  const go = useCallback(
    async (direction: "back" | "forward") => {
      syncCurrent();
      const history = activeHistory();
      const entry = direction === "back" ? history.back() : history.forward();
      if (entry) {
        await live.current.open(entry.path, entry.elementId, "current");
      }
    },
    [activeHistory, syncCurrent],
  );

  // ---- create -----------------------------------------------------------
  const createTarget = useCallback(
    async (target: string) => {
      const d = live.current;
      if (!d.vault || d.vault.readOnly) {
        d.notify("This vault is read-only", "error");
        return;
      }
      const hasFolder = target.includes("/");
      const parent = hasFolder ? "" : await d.prepareParent();
      if (parent === null) {
        return;
      }
      const spot = createSpot(target, parent, d.activePath);
      if (!spot) {
        d.notify(`Cannot create a drawing named "${target}"`, "error");
        return;
      }
      try {
        if (hasFolder && spot.parent) {
          const created = await ensureFolder(
            d.repository,
            d.vault.handle,
            spot.parent,
          );
          if (created.length > 0) {
            for (const folder of ["", ...folderChain(spot.parent)].slice(
              0,
              -1,
            )) {
              await d.loadDirectory(folder);
              if (folder) {
                d.expandFolder(folder);
              }
            }
          }
        }
        await d.createDrawing(spot.parent, spot.name);
        activeHistory().visit({
          path: spot.parent ? `${spot.parent}/${spot.name}` : spot.name,
        });
      } catch (err) {
        d.notify(`Failed to create drawing: ${errorMessage(err)}`, "error");
      }
    },
    [activeHistory],
  );

  const onUnresolved = useCallback(
    async (target: string) => {
      const ok = await ask({
        title: "Create drawing?",
        message: `"${target}" does not exist yet. Create it?`,
        confirmLabel: "Create",
        cancelLabel: "Cancel",
      });
      if (ok) {
        await createTarget(target);
      }
    },
    [ask, createTarget],
  );

  // ---- rename / move ----------------------------------------------------
  /**
   * Move `from` to `to`. `run(move)` performs it (relocating the open drawing
   * when affected) with the given mover; resolves false when the user aborted.
   */
  const moveEntry = useCallback(
    async (
      from: string,
      to: string,
      run: (move: (f: string, t: string) => Promise<unknown>) => Promise<void>,
      /** No dialogs: confirmations auto-accept and links are rewritten (or not). */
      silent?: { rewriteLinks: boolean },
    ): Promise<boolean> => {
      const d = live.current;
      if (!d.vault) {
        return false;
      }
      const h = d.vault.handle;
      const decision = await decideMove(
        {
          links: d.links,
          handle: h,
          mode: silent ? silent.rewriteLinks : d.settings.updateOnRename,
          confirm: silent ? async () => true : ask,
        },
        from,
        to,
      );
      if (decision === "abort") {
        return false;
      }
      let result: MoveResult | null = null;
      if (decision === "rewrite" && d.links) {
        const openPath = d.activePath;
        await run(async (f, t) => {
          result = await d.links!.moveWithLinks(h, f, t, openPath, true);
        });
      } else {
        await run((f, t) => d.repository.move(h, f, t));
      }
      histories.rename(from, to);
      const done = result as MoveResult | null;
      if (done && done.openDrawingEdits.length > 0) {
        const n = bridge.current?.applyEdits(done.openDrawingEdits) ?? 0;
        if (n > 0 && done.jobId === null) {
          d.notify(updatedMessage(n, 1), "info");
        }
      }
      return true;
    },
    [ask, histories],
  );

  // links-rewrite-done: toast, dock refresh, new re-measure entries.
  const fetchRemeasure = useCallback(async () => {
    const { links: l, vault: v } = live.current;
    if (!l || !v) {
      return;
    }
    try {
      const set: RemeasureSet = await l.remeasure(v.handle);
      remeasureSet.current = new Map(Object.entries(set.paths));
      setRemeasureTick((n) => n + 1);
    } catch {
      // No remeasure set: nothing to repair.
    }
  }, []);

  const rewritesOnRename = deps.settings.updateOnRename !== false;
  useEffect(() => {
    if (!links || !(enabled || rewritesOnRename)) {
      return undefined;
    }
    let off: (() => void) | undefined;
    let disposed = false;
    void links
      .onRewriteDone((done) => {
        if (done.handle !== live.current.vault?.handle) {
          return;
        }
        setRefreshKey((n) => n + 1);
        toastRewriteDone(
          done,
          () => live.current.notify,
          () => live.current.vault?.handle,
        );
        if (done.rewritten > 0 && live.current.enabled !== false) {
          void fetchRemeasure();
        }
      })
      .then((unsub) => {
        if (disposed) {
          unsub();
        } else {
          off = unsub;
        }
      })
      .catch(() => {});
    return () => {
      disposed = true;
      off?.();
    };
  }, [links, fetchRemeasure, enabled, rewritesOnRename]);

  // Fetch the re-measure set once per vault, after the first index pass.
  const fetchedFor = useRef<string | null>(null);
  useEffect(() => {
    if (
      !links ||
      !enabled ||
      !handle ||
      deps.indexing ||
      fetchedFor.current === handle
    ) {
      return;
    }
    fetchedFor.current = handle;
    const timers = win ?? window;
    const t = timers.setTimeout(() => void fetchRemeasure(), 1000);
    return () => timers.clearTimeout(t);
  }, [links, enabled, handle, deps.indexing, win, fetchRemeasure]);

  const remeasureIdsFor = (path: string | null): readonly string[] | null =>
    (path && remeasureSet.current.get(path)) || null;
  void remeasureTick;
  const onRemeasured = useCallback((path: string | null) => {
    const { links: l, vault: v } = live.current;
    if (!path || !l || !v) {
      return;
    }
    remeasureSet.current.delete(path);
    void l.remeasureDone(v.handle, path).catch(() => {});
  }, []);

  // ---- dock -------------------------------------------------------------
  const toggleDock = useCallback(() => {
    const next = !dockVisible;
    setDockVisibleState(next);
    setDockVisible(next, live.current.win);
    if (next) {
      live.current.showNavigator();
      setDockFocus((n) => n + 1);
    }
  }, [dockVisible]);

  useEffect(() => {
    if (dockFocus > 0 && dockVisible) {
      const t = setTimeout(() => dockRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [dockFocus, dockVisible, win]);

  // Index status events refresh the dock; only listened to while it shows.
  const search = deps.search;
  useEffect(() => {
    if (!dockVisible || !search || !handle) {
      return undefined;
    }
    let off: (() => void) | undefined;
    let disposed = false;
    let timer: number | null = null;
    const timers = win ?? window;
    void search
      .subscribe((status) => {
        if (status.handle !== handle || timer) {
          return;
        }
        timer = timers.setTimeout(() => {
          timer = null;
          setRefreshKey((n) => n + 1);
        }, 400);
      })
      .then((unsub) => {
        if (disposed) {
          unsub();
        } else {
          off = unsub;
        }
      })
      .catch(() => {});
    return () => {
      disposed = true;
      off?.();
      if (timer) {
        timers.clearTimeout(timer);
      }
    };
  }, [dockVisible, search, handle, win]);

  // ---- commands ---------------------------------------------------------
  useEffect(() => {
    const copyLink = async () => {
      const d = live.current;
      if (!d.activePath) {
        return;
      }
      const target = linkTargetFor(
        d.activePath,
        null,
        createResolver(drawingNames(d.entries)),
        d.settings.newLinkFormat,
      );
      try {
        await (d.win ?? window).navigator.clipboard.writeText(wikiLink(target));
        d.notify(`Copied ${wikiLink(target)}`, "info");
      } catch (err) {
        d.notify(`Could not copy: ${errorMessage(err)}`, "error");
      }
    };
    if (!enabled) {
      return undefined;
    }
    return registerCommandHandlers({
      "links.toggleDock": () => toggleRef.current(),
      "links.back": () => go("back"),
      "links.forward": () => go("forward"),
      "links.copyLinkToDrawing": copyLink,
      "links.toggleStyling": () => {
        const win = live.current.win;
        updatePreferences({ linkStyle: !getPreferences(win).linkStyle }, win);
      },
      "links.toggleHoverPreview": () => {
        const win = live.current.win;
        const now = getPreferences(win).linkHoverPreview;
        updatePreferences(
          { linkHoverPreview: now === "off" ? "always" : "off" },
          win,
        );
      },
      "links.bindDrawingHotkey": () => {
        const d = live.current;
        if (d.activePath) {
          setHotkeyOverride(drawingOpenCommandId(d.activePath), [], d.win);
          d.openHotkeys();
        }
      },
    });
  }, [go, enabled]);
  // `drawing.open:<path>` (hotkeys bound to a drawing) is core: always bound.
  useEffect(
    () =>
      registerCommandPrefixHandler(DRAWING_OPEN_PREFIX, (path) =>
        openLink(path),
      ),
    [openLink],
  );
  const toggleRef = useRef(toggleDock);
  toggleRef.current = toggleDock;

  const dialogs = confirm ? (
    <ConfirmModal
      title={confirm.title}
      message={confirm.message}
      details={confirm.details}
      confirmLabel={confirm.confirmLabel}
      cancelLabel={confirm.cancelLabel}
      onConfirm={() => answer(true)}
      onCancel={() => answer(false)}
    />
  ) : null;

  const editorCallbacks = useMemo(
    () => ({
      openDrawing: (path: string, elementId?: string, target?: OpenTarget) =>
        void openLink(path, elementId, target),
      onUnresolved: (target: string) => void onUnresolved(target),
      onCreate: (target: string) => void createTarget(target),
    }),
    [openLink, onUnresolved, createTarget],
  );

  return {
    names,
    /** The active tab's back/forward history. */
    activeHistory,
    bridge,
    dockRef,
    dockVisible,
    refreshKey,
    openLink,
    createTarget,
    moveEntry,
    editorCallbacks,
    remeasureIdsFor,
    onRemeasured,
    dialogs,
  };
}
