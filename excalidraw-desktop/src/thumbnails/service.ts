/**
 * Per-vault thumbnail service. Surfaces watch paths; lookups are batched (one
 * IPC per animation frame), misses render through the shared job queue and are
 * stored. Memory: strings only (path -> rev/url), bounded. Idle (nothing
 * watched) = no timers, no listeners, no work.
 */
import { createJobQueue } from "./queue";
import { thumbDensity } from "./fit";
import { failMarkerVersion, pngRenderVersion, renderScenePng } from "./render";
import { enterStandardColors } from "./standardColors";
import { LOOKUP_BATCH_MAX } from "./store";

import type { JobQueue, Priority } from "./queue";
import type { RenderPng } from "./render";
import type { ThumbnailStore } from "./store";

export type ThumbState = {
  status: "loading" | "ready" | "none";
  url: string | null;
};

export const THUMB_LOADING: ThumbState = Object.freeze({
  status: "loading",
  url: null,
});
export const THUMB_NONE: ThumbState = Object.freeze({
  status: "none",
  url: null,
});

export interface ThumbnailService {
  /** Subscribes to the thumbnail state of `path`; unsubscribing cancels a queued render. */
  watch(
    path: string,
    cb: (state: ThumbState) => void,
    opts?: { priority?: Priority },
  ): () => void;
  /** A save produced `revision`: marks the thumbnail stale (O(1)); refreshes only if watched. */
  noteSaved(path: string, revision: string): void;
  /** Watcher events: drops entries at/under these paths ("" = everything). */
  invalidate(paths: string[]): void;
  /** Re-checks one path (e.g. its image failed to load). */
  refresh(path: string): void;
  setEnabled(on: boolean): void;
  dispose(): void;
}

export type VaultChangeLike = {
  handle: string;
  paths: string[];
  rescan: boolean;
};

export interface ThumbnailServiceDeps {
  store: ThumbnailStore;
  handle: string;
  readDrawing(path: string): Promise<{ json: string; revision: string }>;
  /** VaultRepository.subscribe-compatible; used only while something is watched. */
  subscribe?(
    listener: (event: VaultChangeLike) => void,
  ): Promise<() => void> | (() => void);
  render?: RenderPng;
  /** Device pixels per CSS pixel (default: this window's, sampled once). */
  density?: number;
  queue?: JobQueue;
  /** Frame scheduler (tests inject a manual one). */
  schedule?: (fn: () => void) => void;
  maxEntries?: number;
}

type Entry = {
  rev: string | null;
  state: ThumbState;
  busy: boolean; // lookup or render in flight / queued
  stale: boolean; // a save/invalidate arrived while busy
  attempts: number; // `pending` retries
};

const MAX_PENDING_RETRIES = 60;

let sharedQueue: JobQueue | null = null;
/** One serial queue (one standard-colours scope per drain) for every service. */
const getSharedQueue = () =>
  (sharedQueue ??= createJobQueue({ scope: enterStandardColors }));

const defaultSchedule = (fn: () => void) => {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => fn());
  } else {
    setTimeout(fn, 16);
  }
};

export const createThumbnailService = (
  deps: ThumbnailServiceDeps,
): ThumbnailService => {
  const { store, handle } = deps;
  const render = deps.render ?? renderScenePng;
  const density =
    deps.density ??
    thumbDensity(
      typeof window === "undefined" ? undefined : window.devicePixelRatio,
    );
  const renderVersion = pngRenderVersion(density);
  const failVersion = failMarkerVersion(density);
  const queue = deps.queue ?? getSharedQueue();
  const schedule = deps.schedule ?? defaultSchedule;
  const maxEntries = deps.maxEntries ?? 20000;

  const entries = new Map<string, Entry>();
  const watchers = new Map<
    string,
    Map<symbol, { cb: (s: ThumbState) => void; priority: Priority }>
  >();
  const toLookup = new Map<string, Priority>();
  const queuedKeys = new Set<string>(); // queue keys we own (for cancel-all)
  let vaultId = "";
  let enabled = true;
  let disposed = false;
  let frameScheduled = false;
  let unsubscribeRepo: (() => void) | null = null;
  let subscribing = false;

  const queueKey = (path: string) => `thumb\u0000${handle}\u0000${path}`;
  const isWatched = (path: string) => (watchers.get(path)?.size ?? 0) > 0;
  const live = () => enabled && !disposed;

  const priorityOf = (path: string): Priority => {
    for (const w of watchers.get(path)?.values() ?? []) {
      if (w.priority === "visible") {
        return "visible";
      }
    }
    return "near";
  };

  const entryFor = (path: string): Entry => {
    let e = entries.get(path);
    if (!e) {
      e = {
        rev: null,
        state: THUMB_LOADING,
        busy: false,
        stale: false,
        attempts: 0,
      };
      entries.set(path, e);
      if (entries.size > maxEntries) {
        for (const [key, candidate] of entries) {
          if (entries.size <= maxEntries) {
            break;
          }
          if (key !== path && !candidate.busy && !isWatched(key)) {
            entries.delete(key);
          }
        }
      }
    }
    return e;
  };

  const publish = (path: string, e: Entry, state: ThumbState) => {
    if (e.state === state) {
      return;
    }
    e.state = state;
    for (const w of [...(watchers.get(path)?.values() ?? [])]) {
      w.cb(state);
    }
  };

  const readyState = (url: string): ThumbState => ({ status: "ready", url });

  const scheduleFrame = () => {
    if (frameScheduled || toLookup.size === 0) {
      return;
    }
    frameScheduled = true;
    schedule(() => {
      frameScheduled = false;
      void flushLookups();
    });
  };

  const queueLookup = (path: string, priority: Priority) => {
    if (!live() || !isWatched(path)) {
      return;
    }
    const e = entryFor(path);
    e.busy = true;
    if (toLookup.get(path) !== "visible") {
      toLookup.set(path, priority);
    }
    scheduleFrame();
  };

  /** Re-checks a path whose result may be outdated (after a render/lookup). */
  const settle = (path: string, e: Entry) => {
    e.busy = false;
    if (e.stale) {
      e.stale = false;
      if (isWatched(path)) {
        queueLookup(path, priorityOf(path));
      }
    }
  };

  const renderMiss = async (path: string, e: Entry) => {
    const key = queueKey(path);
    queuedKeys.add(key);
    const outcome = await queue.add(
      key,
      async (signal): Promise<"done" | "skipped" | "failed"> => {
        if (!live() || !isWatched(path)) {
          return "skipped";
        }
        try {
          const { json, revision } = await deps.readDrawing(path);
          // Polled at every render yield: a scrolled-past or unwatched
          // drawing stops parsing/painting at the next slice.
          const result = await render(
            json,
            density,
            () => signal.aborted || !live() || !isWatched(path),
          );
          // The entry may have been dropped and recreated while this job ran
          // (unwatch + re-watch joins the started job): publish to the current one.
          const target = entries.get(path);
          if (
            !live() ||
            signal.aborted ||
            !target ||
            (result.kind === "fail" && result.reason === "cancelled")
          ) {
            return "skipped";
          }
          target.rev = revision; // the revision actually read, not the looked-up one
          if (result.kind === "png") {
            const url = await store.put(
              handle,
              path,
              revision,
              result.blob,
              renderVersion,
            );
            publish(
              path,
              target,
              readyState(url ?? store.urlFor(vaultId, revision, renderVersion)),
            );
          } else {
            if (result.reason !== "error") {
              await store.put(handle, path, revision, null, failVersion);
            }
            publish(path, target, THUMB_NONE);
          }
          return "done";
        } catch {
          return "failed";
        }
      },
      priorityOf(path),
      "failed", // a hung job counts as an error (no fail marker)
    );
    queuedKeys.delete(key);
    if (outcome === null) {
      return; // cancelled: unwatch / disable already reset the entry
    }
    const current = entries.get(path) ?? e;
    if (outcome === "failed" && live() && isWatched(path)) {
      publish(path, current, THUMB_NONE);
    }
    if (
      outcome === "skipped" &&
      live() &&
      isWatched(path) &&
      current.state.status === "loading"
    ) {
      // Cancelled while unwatched, then watched again (joined the job):
      // look it up afresh instead of leaving it loading.
      current.stale = true;
    }
    settle(path, current);
  };

  const handleItem = (
    path: string,
    item: { rev: string | null; state: string },
  ) => {
    const e = entries.get(path);
    if (!e || !isWatched(path)) {
      if (e) {
        e.busy = false;
      }
      return;
    }
    if (item.state !== "pending") {
      e.attempts = 0;
    }
    switch (item.state) {
      case "hit":
        e.rev = item.rev;
        publish(
          path,
          e,
          readyState(store.urlFor(vaultId, item.rev!, renderVersion)),
        );
        settle(path, e);
        break;
      case "miss":
        e.rev = item.rev;
        void renderMiss(path, e);
        break;
      case "pending":
        if (++e.attempts > MAX_PENDING_RETRIES) {
          publish(path, e, THUMB_NONE);
          settle(path, e);
        } else {
          toLookup.set(path, priorityOf(path));
        }
        break;
      default: // failed | missing
        e.rev = item.rev;
        publish(path, e, THUMB_NONE);
        settle(path, e);
    }
  };

  const flushLookups = async () => {
    if (!live() || toLookup.size === 0) {
      toLookup.clear();
      return;
    }
    const paths = [...toLookup.keys()]
      .filter(isWatched)
      .sort(
        (a, b) =>
          Number(toLookup.get(b) === "visible") -
          Number(toLookup.get(a) === "visible"),
      )
      .slice(0, LOOKUP_BATCH_MAX);
    for (const p of paths) {
      toLookup.delete(p);
    }
    scheduleFrame(); // the rest, plus `pending` retries added below
    if (paths.length === 0) {
      return;
    }
    try {
      const res = await store.lookup(handle, paths, renderVersion, failVersion);
      if (!live()) {
        return;
      }
      vaultId = res.vaultId;
      paths.forEach((p, i) =>
        handleItem(p, res.items[i] ?? { rev: null, state: "missing" }),
      );
    } catch {
      for (const p of paths) {
        const e = entries.get(p);
        if (e) {
          publish(p, e, THUMB_NONE);
          e.busy = false;
        }
      }
    }
    scheduleFrame();
  };

  // --- repository change events: subscribed only while something is watched

  const dropEntries = (paths: string[], all: boolean) => {
    for (const [key, e] of [...entries]) {
      if (
        !all &&
        !paths.some((p) => p === "" || key === p || key.startsWith(`${p}/`))
      ) {
        continue;
      }
      if (toLookup.has(key)) {
        continue; // a lookup is already queued for the next frame
      }
      if (e.busy) {
        e.stale = true; // refreshed when the in-flight job settles
      } else if (isWatched(key)) {
        queueLookup(key, priorityOf(key)); // keeps showing the old image meanwhile
      } else {
        entries.delete(key);
      }
    }
  };

  const ensureSubscribed = () => {
    if (!deps.subscribe || unsubscribeRepo || subscribing || !live()) {
      return;
    }
    subscribing = true;
    void Promise.resolve(
      deps.subscribe((event) => {
        if (event.handle === handle) {
          dropEntries(event.paths, event.rescan);
        }
      }),
    )
      .then((unsub) => {
        subscribing = false;
        if (watchers.size === 0 || !live()) {
          unsub();
        } else {
          unsubscribeRepo = unsub;
        }
      })
      .catch(() => {
        subscribing = false;
      });
  };

  const releaseSubscription = () => {
    unsubscribeRepo?.();
    unsubscribeRepo = null;
  };

  // --- public api

  const watch: ThumbnailService["watch"] = (path, cb, opts) => {
    if (!live()) {
      cb(THUMB_NONE);
      return () => {};
    }
    const id = Symbol(path);
    let set = watchers.get(path);
    if (!set) {
      set = new Map();
      watchers.set(path, set);
    }
    set.set(id, { cb, priority: opts?.priority ?? "visible" });
    ensureSubscribed();

    const e = entryFor(path);
    cb(e.state);
    if (!e.busy && e.state.status === "loading") {
      queueLookup(path, priorityOf(path));
    } else if (e.busy && opts?.priority !== "near" && toLookup.has(path)) {
      toLookup.set(path, "visible");
    }

    return () => {
      const current = watchers.get(path);
      if (!current?.delete(id)) {
        return;
      }
      if (current.size === 0) {
        watchers.delete(path);
        toLookup.delete(path);
        queue.cancel(queueKey(path));
        const entry = entries.get(path);
        if (entry) {
          entry.busy = false;
        }
        if (watchers.size === 0) {
          // Nothing watches: no listener, and nothing would invalidate the
          // cache, so forget it (the next watch re-checks with one lookup).
          releaseSubscription();
          for (const [key, cached] of entries) {
            if (!cached.busy) {
              entries.delete(key);
            }
          }
        }
      }
    };
  };

  const clearAll = () => {
    toLookup.clear();
    for (const key of queuedKeys) {
      queue.cancel(key);
    }
    queuedKeys.clear();
    entries.clear();
    releaseSubscription();
  };

  return {
    watch,
    noteSaved(path, revision) {
      const e = entries.get(path);
      if (!live() || !e || e.rev === revision) {
        return;
      }
      if (toLookup.has(path)) {
        return; // coalesced into the lookup already queued
      }
      if (e.busy) {
        e.stale = true;
      } else if (isWatched(path)) {
        queueLookup(path, "near");
      } else {
        entries.delete(path);
      }
    },
    invalidate: (paths) => dropEntries(paths, false),
    refresh: (path) => dropEntries([path], false),
    setEnabled(on) {
      if (on === enabled || disposed) {
        return;
      }
      enabled = on;
      if (!on) {
        clearAll();
        for (const [, set] of watchers) {
          for (const w of [...set.values()]) {
            w.cb(THUMB_NONE);
          }
        }
      } else {
        for (const [path, set] of watchers) {
          for (const w of [...set.values()]) {
            w.cb(THUMB_LOADING);
          }
          queueLookup(path, priorityOf(path));
        }
        ensureSubscribed();
      }
    },
    dispose() {
      disposed = true;
      clearAll();
      watchers.clear();
    },
  };
};
