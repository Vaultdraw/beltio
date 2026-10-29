/**
 * Tabs (F5): framework-free controller. Orchestrates tab actions over
 * injected dependencies (store, memory, document IO, live editor), so it is
 * unit-testable with fakes. A thin `useTabs` hook adds React glue later.
 * PLAN.md §2 (switch sequence) and §3 (opening rules, closing, busy states).
 *
 * Model of operation
 * - Every action is a pure `tabsModel` transition applied with `store.update`.
 * - The controller remembers what the document hook currently shows
 *   (`loaded`). After each state change, if the active tab differs from
 *   `loaded` (another tab, or the same tab with a replaced path), a single
 *   "pump" loop runs the switch: capture the outgoing tab, then
 *   `openDocument(path)` (or `closeDocument()` for home / missing tabs).
 * - Coalescing: the store IS the generation. The pump re-reads the active tab
 *   after every await, so activations that arrive while an open is in flight
 *   only move the target; one extra open runs for the latest target.
 * - Capture happens before the open, in the same synchronous turn as the
 *   action that changed the active tab (or right after the previous open
 *   settled, when coalescing).
 *
 * Failure policy (openDocument throws): `onError`, then
 * - a tab created by this action (target "new", reopen closed) is closed
 *   without a closed-stack entry (it never showed a document);
 * - a tab whose path was replaced (target "current") gets its old record
 *   back (path, pinned, view);
 * - if the failed tab is still active, activation returns to the previously
 *   shown tab; with no such tab (closing the active tab, session restore) the
 *   failed tab is marked missing and shows the placeholder (closeDocument).
 * If the hook no longer shows the previous document, `loaded` becomes
 * unknown and the rollback target is reopened (once; a second failure marks
 * it missing, so this always terminates).
 */

import {
  canCloseWithShortcut,
  findByPath,
  fromSession,
  getActiveTab,
  initialState,
  targetForCreated,
} from "./tabsModel";
import * as model from "./tabsModel";
import { createTabStore } from "./tabStore";
import { TabMemory } from "./tabMemory";

import type { TabStore } from "./tabStore";
import type { OpenOptions, Tab, TabId, TabsState, ViewState } from "./types";
import type { RestoredSession } from "./workspaceStore";

export type TabsControllerDeps = {
  store: TabStore;
  memory: TabMemory<unknown>;
  /** Today's docHook.open: flushes the active document, loads; throws on failure. */
  openDocument: (path: string) => Promise<void>;
  /** Flush and unmount the editor (home and missing tabs). */
  closeDocument: () => Promise<void>;
  currentDocument: () => { path: string; revision: string } | null;
  /** Reads the live editor; null when no editor is mounted. */
  captureEditor: () => { view: ViewState; undo: unknown } | null;
  estimateBytes: (value: unknown) => number;
  /** The active document has a pending conflict: switching is refused. */
  isConflictBlocking: () => boolean;
  onError?: (err: unknown) => void;
  /** Toast "Pinned tab: unpin to close". */
  onPinnedCloseBlocked?: () => void;
  /** Setting `tabs.close_pinned`. */
  closePinnedWithShortcut: () => boolean;
  /**
   * Optional: flush the live document before the revision is read for the
   * capture. Without it the revision is read at capture time; if a save bumps
   * the revision, the undo is (correctly, but uselessly) dropped on return.
   */
  flushDocument?: () => Promise<void>;
  /**
   * A path a tab kind shows (see tabKinds.ts): no document is opened for it,
   * the editor is closed like for the home tab, and the gate renders the view.
   */
  isCustomKind?: (path: string) => boolean;
  /**
   * The user navigates to a file or tab (open, activate, next/previous, new tab,
   * reopen): a view covering the main area must give way. Called once per request.
   */
  onNavigate?: () => void;
  /** Called after every change that matters (debounced by the caller). */
  session?: { save: (state: TabsState) => void };
};

/** What the editor mount needs for a document of a tab. */
export type TabRestore = { view?: ViewState; undo?: unknown };

type Loaded = {
  tabId: TabId;
  /** The tab's path when it was loaded (null for home). */
  path: string | null;
  /** A document is mounted for it (false for home and placeholder tabs). */
  shown: boolean;
};

type Origin = { kind: "created" } | { kind: "replaced"; tab: Tab };

type ApplyOptions = {
  /** Vault events are never refused by a conflict. */
  force?: boolean;
  /** Path changes keep memory entries (the caller renames them). */
  renaming?: boolean;
  /** The document for this path is already open (Cmd+N, template). */
  alreadyOpen?: string;
};

const rebase = (p: string | null, from: string, to: string): string | null =>
  p === from
    ? to
    : p !== null && p.startsWith(`${from}/`)
    ? to + p.slice(from.length)
    : p;

export class TabsController {
  private loaded: Loaded | null = null;
  private busy = false;
  private running: Promise<void> = Promise.resolve();
  private origins = new Map<TabId, Origin>();
  private disposed = false;

  constructor(private readonly deps: TabsControllerDeps) {
    // A fresh runtime shows no document, so an initial home tab is satisfied.
    const tab = getActiveTab(deps.store.getState());
    if (tab.path === null) {
      this.loaded = { tabId: tab.id, path: null, shown: false };
    }
  }

  // -- queries --------------------------------------------------------------

  /** Resolves when no switch is in flight (all coalesced targets opened). */
  whenIdle(): Promise<void> {
    return this.busy ? this.running : Promise.resolve();
  }

  /** View for a path's tab, for `initialData.appState` (does not consume undo). */
  pendingRestore(path: string): TabRestore {
    const tab = findByPath(this.deps.store.getState(), path);
    return tab?.view ? { view: tab.view } : {};
  }

  /**
   * Called by the editor mount: view plus the undo snapshot, which is
   * returned (and consumed) only when path and revision both match.
   */
  takeRestore(path: string, revision: string): TabRestore {
    const tab = findByPath(this.deps.store.getState(), path);
    if (!tab) {
      return {};
    }
    const undo = this.deps.memory.take(tab.id, path, revision);
    return {
      ...(tab.view ? { view: tab.view } : {}),
      ...(undo !== null ? { undo } : {}),
    };
  }

  /**
   * Capture view (and undo) of the active tab now, e.g. before the app quits
   * so the saved session has the latest view. Also call it before creating a
   * document that will be handed to `openCreated`, so the outgoing tab keeps
   * its view and undo (the editor is gone once the new document mounts).
   */
  captureActive(): void {
    void this.capture(this.loaded)?.catch((e) => this.deps.onError?.(e));
    this.saveSession();
  }

  // -- opening --------------------------------------------------------------

  openPath(path: string, options: OpenOptions): Promise<void> {
    this.deps.onNavigate?.();
    return this.run((s) => model.openPath(s, path, options));
  }

  /**
   * A document that was just created and is already open in the editor
   * (Cmd+N, template, duplicate). Target by `targetForCreated` (a home tab is
   * reused, else a new tab), always focused. No reopen: the controller only
   * records the tab and treats the new tab as showing the document.
   */
  openCreated(path: string): Promise<void> {
    this.deps.onNavigate?.();
    return this.run(
      (s) =>
        model.openPath(s, path, { target: targetForCreated(s), focus: true }),
      { alreadyOpen: path },
    );
  }

  newTab(position?: OpenOptions["position"]): Promise<void> {
    this.deps.onNavigate?.();
    return this.run((s) => model.newTab(s, position));
  }

  // -- switching ------------------------------------------------------------

  activate(id: TabId): Promise<void> {
    return this.navigate((s) => model.activate(s, id));
  }
  next = (): Promise<void> => this.navigate(model.next);
  prev = (): Promise<void> => this.navigate(model.prev);
  goTo = (n: number): Promise<void> => this.navigate((s) => model.goTo(s, n));
  goToLast = (): Promise<void> => this.navigate(model.goToLast);
  mruNext = (): Promise<void> => this.navigate(model.mruNext);
  mruPrev = (): Promise<void> => this.navigate(model.mruPrev);

  // -- closing --------------------------------------------------------------

  /** Always closes (context menu). */
  close(id: TabId): Promise<void> {
    return this.run((s) => model.close(s, id));
  }

  /** Cmd+W: pinned tabs are protected unless `closePinnedWithShortcut()`. */
  closeWithShortcut(id: TabId): Promise<void> {
    if (
      !canCloseWithShortcut(
        this.deps.store.getState(),
        id,
        this.deps.closePinnedWithShortcut(),
      )
    ) {
      this.deps.onPinnedCloseBlocked?.();
      return this.whenIdle();
    }
    return this.close(id);
  }

  closeOthers(id: TabId): Promise<void> {
    return this.run((s) => model.closeOthers(s, id));
  }
  closeRight(id: TabId): Promise<void> {
    return this.run((s) => model.closeRight(s, id));
  }
  closeAll(): Promise<void> {
    return this.run(model.closeAll);
  }
  reopenClosed(): Promise<void> {
    return this.navigate(model.reopenClosed);
  }

  // -- order ----------------------------------------------------------------

  togglePin(id: TabId): Promise<void> {
    return this.run((s) => model.togglePin(s, id));
  }
  move(id: TabId, toIndex: number): Promise<void> {
    return this.run((s) => model.move(s, id, toIndex));
  }
  moveBy(id: TabId, delta: 1 | -1): Promise<void> {
    return this.run((s) => model.moveBy(s, id, delta));
  }

  // -- vault events ---------------------------------------------------------

  /** In-app rename or move: tabs, closed stack and undo entries follow. */
  renamed(from: string, to: string): void {
    this.apply((s) => model.renamePath(s, from, to), {
      force: true,
      renaming: true,
    });
    this.deps.memory.renamePath(from, to);
    if (this.loaded?.path) {
      this.loaded = {
        ...this.loaded,
        path: rebase(this.loaded.path, from, to),
      };
    }
    void this.kick();
  }

  /** In-app trash of a file or folder: its tabs close (no closed-stack entry). */
  removed(path: string): Promise<void> {
    return this.run((s) => model.removePath(s, path), { force: true });
  }

  /** Outside delete/rename marks a tab missing; the file coming back clears it. */
  setMissing(path: string, missing: boolean): Promise<void> {
    return this.run((s) => model.setMissing(s, path, missing), {
      force: true,
    });
  }

  // -- session --------------------------------------------------------------

  /** Replace the state from a restored session; only the active tab is opened. */
  restore(session: RestoredSession | null): Promise<void> {
    this.deps.memory.clear();
    this.origins.clear();
    this.loaded = null; // unknown: the active tab is (re)opened
    this.deps.store.update(() =>
      session && session.tabs.length > 0
        ? fromSession(session)
        : initialState(),
    );
    this.saveSession();
    return this.kick();
  }

  dispose(): void {
    this.disposed = true;
  }

  // -- internals ------------------------------------------------------------

  /** A user navigation: a covering view gives way, then the state changes. */
  private navigate(fn: (s: TabsState) => TabsState): Promise<void> {
    this.deps.onNavigate?.();
    return this.run(fn);
  }

  private run(
    fn: (s: TabsState) => TabsState,
    opts: ApplyOptions = {},
  ): Promise<void> {
    this.apply(fn, opts);
    return this.kick();
  }

  private saveSession(): void {
    this.deps.session?.save(this.deps.store.getState());
  }

  private key(tab: Tab): { id: TabId; path: string | null } {
    return { id: tab.id, path: tab.path };
  }

  private custom(tab: Tab): boolean {
    return tab.path !== null && (this.deps.isCustomKind?.(tab.path) ?? false);
  }

  /** The active tab when it still needs a switch, else null. */
  private pending(state: TabsState): Tab | null {
    const tab = getActiveTab(state);
    const l = this.loaded;
    if (
      l &&
      l.tabId === tab.id &&
      l.path === tab.path &&
      (l.shown || tab.path === null || tab.missing || this.custom(tab))
    ) {
      return null;
    }
    return tab;
  }

  /** Applies a transition; false when nothing changed or a conflict refused it. */
  private apply(fn: (s: TabsState) => TabsState, opts: ApplyOptions): boolean {
    const { store, memory } = this.deps;
    const before = store.getState();
    const after = fn(before);
    if (after === before) {
      return false;
    }
    if (
      !opts.force &&
      !this.busy &&
      this.pending(after) &&
      this.deps.isConflictBlocking()
    ) {
      return false; // like the navigator switch: resolve the conflict first
    }
    store.update(() => after);

    const afterById = new Map(after.tabs.map((t) => [t.id, t]));
    const beforeById = new Map(before.tabs.map((t) => [t.id, t]));
    for (const old of before.tabs) {
      const now = afterById.get(old.id);
      if (!now) {
        memory.delete(old.id);
        this.origins.delete(old.id);
      } else if (now.path !== old.path) {
        if (!opts.renaming) {
          memory.delete(old.id); // another drawing now: its undo is meaningless
          this.origins.set(old.id, { kind: "replaced", tab: old });
        }
      }
    }
    for (const now of after.tabs) {
      if (!beforeById.has(now.id)) {
        this.origins.set(now.id, { kind: "created" });
      }
    }

    if (
      opts.alreadyOpen !== undefined &&
      !this.busy &&
      this.deps.currentDocument()?.path === opts.alreadyOpen
    ) {
      const active = getActiveTab(after);
      if (active.path === opts.alreadyOpen) {
        this.loaded = { tabId: active.id, path: active.path, shown: true };
        this.origins.delete(active.id);
      }
    }
    this.saveSession();
    return true;
  }

  private kick(): Promise<void> {
    if (this.busy) {
      return this.running;
    }
    if (this.disposed || !this.pending(this.deps.store.getState())) {
      return Promise.resolve();
    }
    const p = this.pump();
    if (this.busy) {
      this.running = p;
    }
    return p;
  }

  /** Reads the live editor into the outgoing tab (view) and memory (undo). */
  private capture(l: Loaded | null): Promise<void> | undefined {
    const { deps } = this;
    const { store, memory } = deps;
    if (!l || !l.shown || l.path === null) {
      return;
    }
    const tab = store.getState().tabs.find((t) => t.id === l.tabId);
    if (!tab || tab.path !== l.path) {
      return; // closed, or another drawing now: nothing of it to keep
    }
    const cap = deps.captureEditor();
    if (!cap) {
      return;
    }
    store.update((s) => model.setView(s, tab.id, cap.view));
    const path = l.path;
    const putUndo = (): void => {
      const doc = deps.currentDocument();
      if (doc && doc.path === path) {
        memory.put(tab.id, {
          path,
          revision: doc.revision,
          snapshot: cap.undo,
          bytes: deps.estimateBytes(cap.undo),
        });
      }
    };
    if (deps.flushDocument) {
      return deps.flushDocument().then(putUndo);
    }
    putUndo(); // synchronous: the open starts in the same turn
    return undefined;
  }

  private async pump(): Promise<void> {
    this.busy = true;
    // A tab whose load failed and is still the one pending (closing to the home tab when the
    // document cannot be closed: its vault went away) is not retried in this run: retrying
    // at once spun forever in microtasks and froze the window (hunter B, 2026-10-30). The next
    // state change pumps again.
    let failedId: string | null = null;
    try {
      for (;;) {
        const tab = this.disposed
          ? null
          : this.pending(this.deps.store.getState());
        if (!tab || tab.id === failedId) {
          return;
        }
        const prev = this.loaded;
        try {
          const pendingCapture = this.capture(prev);
          if (pendingCapture) {
            await pendingCapture;
          }
        } catch (err) {
          this.deps.onError?.(err);
        }
        // The state may have moved while capture awaited a flush.
        const target = this.pending(this.deps.store.getState());
        if (!target) {
          return;
        }
        try {
          if (target.path === null || target.missing || this.custom(target)) {
            await this.deps.closeDocument();
            this.loaded = { tabId: target.id, path: target.path, shown: false };
          } else {
            await this.deps.openDocument(target.path);
            this.loaded = { tabId: target.id, path: target.path, shown: true };
          }
          this.origins.delete(target.id);
        } catch (err) {
          this.failed(target, prev, err);
          // Retry only when the failure changed what is pending (a tab marked missing now
          // closes the document instead of opening it).
          const next = this.pending(this.deps.store.getState());
          if (
            next?.id === target.id &&
            next.path === target.path &&
            next.missing === target.missing
          ) {
            failedId = target.id;
          }
        }
      }
    } finally {
      this.busy = false;
    }
  }

  private failed(target: Tab, prev: Loaded | null, err: unknown): void {
    const { deps } = this;
    const { store } = deps;
    deps.onError?.(err);
    const origin = this.origins.get(target.id);
    this.origins.delete(target.id);
    this.deps.memory.delete(target.id);

    const doc = deps.currentDocument();
    this.loaded =
      prev && prev.shown && doc?.path === prev.path
        ? prev
        : prev && !prev.shown && doc === null
        ? prev
        : null; // the hook lost the previous document: reopen on rollback

    store.update((s) => {
      let n = s;
      if (origin?.kind === "created") {
        if (target.path !== null) {
          n = model.removePath(n, target.path);
        }
      } else if (origin?.kind === "replaced") {
        const old = origin.tab;
        n = {
          ...n,
          tabs: n.tabs.map((t) => (t.id === target.id ? old : t)),
        };
      }
      const stillActive = getActiveTab(n).id === target.id;
      if (stillActive && n.tabs.some((t) => t.id === target.id)) {
        const back =
          prev && prev.tabId !== target.id
            ? n.tabs.find((t) => t.id === prev.tabId)
            : undefined;
        if (back) {
          n = model.activate(n, back.id);
        } else if (origin?.kind !== "replaced" && target.path !== null) {
          n = model.setMissing(n, target.path, true);
        }
      }
      return n;
    });
    this.saveSession();
  }
}

export const createTabsController = (
  deps: TabsControllerDeps,
): TabsController => new TabsController(deps);

/**
 * Convenience wiring: a store plus a memory whose pinned exemption reads the
 * store, plus the controller.
 */
export const createTabsRuntime = (
  deps: Omit<TabsControllerDeps, "store" | "memory"> & {
    undoBudgetBytes: number;
    initialState?: TabsState;
  },
): {
  store: TabStore;
  memory: TabMemory<unknown>;
  controller: TabsController;
} => {
  const store = createTabStore(deps.initialState);
  const memory = new TabMemory<unknown>({
    budgetBytes: deps.undoBudgetBytes,
    isPinned: (id) =>
      store.getState().tabs.find((t) => t.id === id)?.pinned ?? false,
  });
  return {
    store,
    memory,
    controller: new TabsController({ ...deps, store, memory }),
  };
};
