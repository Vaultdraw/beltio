import { hashElementsVersion } from "@excalidraw/element";
import {
  restoreLibraryItems,
  serializeLibraryAsJSON,
} from "@excalidraw/excalidraw";

import type { LibraryItem, LibraryItems } from "@excalidraw/excalidraw/types";

import { scheduleIdle } from "../platform/idle";
import { errorMessage } from "../vault/types";

import type { LibraryChange, LibraryRepository, LibraryScope } from "./types";

/**
 * Host-side store behind Excalidraw's single editor library. It owns two
 * files (personal + this vault), remembers which file each item belongs to,
 * loads lazily, writes debounced and revision-guarded, and merges external
 * edits. Pure TypeScript; it survives editor remounts.
 */

export const WRITE_DEBOUNCE_MS = 600;
export const WRITE_MAX_WAIT_MS = 2000;
const IDLE_TIMEOUT_MS = 1500;
const IDLE_FALLBACK_MS = 400;
const MAX_CONFLICT_RETRIES = 3;
const TORN_RETRY_MS = 300;

export type StoreEventKind = "ui" | "external";

type Source = {
  scope: LibraryScope;
  handle: string | null;
  /** Vault opened read-only by the host. */
  hostReadOnly: boolean;
  /** Reported by the backend (permissions / read-only vault). */
  diskReadOnly: boolean;
  items: LibraryItem[];
  /** Signature per item, parallel to `items`. */
  sigs: string[];
  /** Signatures as of the last disk sync (read or successful write). */
  base: Map<string, string>;
  revision: string | null;
  existed: boolean;
  loaded: boolean;
  loading: Promise<void> | null;
  /** The file could not be read/parsed: never written until it is fixed. */
  error: string | null;
  writeError: string | null;
  queue: Promise<unknown>;
  debounce: ReturnType<typeof setTimeout> | null;
  maxWait: ReturnType<typeof setTimeout> | null;
};

const newSource = (
  scope: LibraryScope,
  handle: string | null,
  hostReadOnly = false,
): Source => ({
  scope,
  handle,
  hostReadOnly,
  diskReadOnly: false,
  items: [],
  sigs: [],
  base: new Map(),
  revision: null,
  existed: false,
  loaded: false,
  loading: null,
  error: null,
  writeError: null,
  queue: Promise.resolve(),
  debounce: null,
  maxWait: null,
});

const itemSig = (item: LibraryItem) =>
  `${item.id}:${item.name || ""}:${hashElementsVersion(item.elements)}`;

const sigsOf = (items: readonly LibraryItem[]) => items.map(itemSig);

const sameSigs = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((sig, i) => sig === b[i]);

const writable = (src: Source) =>
  !src.error && !src.hostReadOnly && !src.diskReadOnly;

const label = (src: Source) =>
  src.scope === "vault"
    ? "This vault's library.excalidrawlib"
    : "Your personal library (library.excalidrawlib)";

const SLICE_BUDGET_MS = 12;
const SLICE_ITEMS = 25;

const yieldToMain = (): Promise<void> => {
  const sched = (globalThis as { scheduler?: { yield?: () => Promise<void> } })
    .scheduler;
  return sched?.yield
    ? sched.yield()
    : new Promise((resolve) => setTimeout(resolve, 0));
};

/**
 * Maps `items` in slices, yielding to the event loop whenever a slice used up
 * its time budget so a 20 MB library never blocks the UI thread in one task.
 * Small inputs finish synchronously within a single slice (no yield).
 */
async function inSlices<T, R>(
  items: readonly T[],
  fn: (slice: T[]) => R[],
): Promise<R[]> {
  const out: R[] = [];
  let sliceStart = performance.now();
  for (let i = 0; i < items.length; i += SLICE_ITEMS) {
    out.push(...fn(items.slice(i, i + SLICE_ITEMS)));
    if (performance.now() - sliceStart > SLICE_BUDGET_MS) {
      await yieldToMain();
      sliceStart = performance.now();
    }
  }
  return out;
}

/** One item per line, so the file stays diff-friendly without 2-space indent. */
const serializeLibrary = async (items: readonly LibraryItem[]) => {
  const lines = await inSlices(items, (slice) =>
    slice.map((item) => JSON.stringify(item)),
  );
  // header (type/version/source) comes from the package serializer
  const empty = serializeLibraryAsJSON([]);
  const at = empty.indexOf('"libraryItems": []');
  return lines.length
    ? `${empty.slice(0, at)}"libraryItems": [\n${lines.join(
        ",\n",
      )}\n  ]${empty.slice(at + '"libraryItems": []'.length)}`
    : empty;
};

const parseLibrary = async (json: string): Promise<LibraryItem[]> => {
  const data = JSON.parse(json) as {
    type?: unknown;
    libraryItems?: unknown;
    library?: unknown;
  };
  if (!data || typeof data !== "object" || data.type !== "excalidrawlib") {
    throw new Error("not an .excalidrawlib file");
  }
  const raw = data.libraryItems ?? data.library;
  if (!Array.isArray(raw)) {
    throw new Error("missing libraryItems");
  }
  return inSlices(raw as never[], (slice) =>
    restoreLibraryItems(slice, "unpublished"),
  );
};

type Delta = { upserts: Map<string, LibraryItem>; deleted: Set<string> };

/** Local changes since the last disk sync, or null when there are none. */
const pendingDelta = (src: Source): Delta | null => {
  const upserts = new Map<string, LibraryItem>();
  const seen = new Set<string>();
  src.items.forEach((item, i) => {
    seen.add(item.id);
    if (src.base.get(item.id) !== src.sigs[i]) {
      upserts.set(item.id, item);
    }
  });
  const deleted = new Set<string>();
  for (const id of src.base.keys()) {
    if (!seen.has(id)) {
      deleted.add(id);
    }
  }
  return upserts.size || deleted.size ? { upserts, deleted } : null;
};

/** Excalidraw's persistLibraryUpdate semantics: new items go first. */
const applyDelta = (disk: LibraryItem[], delta: Delta): LibraryItem[] => {
  const placed = new Set<string>();
  const kept: LibraryItem[] = [];
  for (const item of disk) {
    if (delta.deleted.has(item.id)) {
      continue;
    }
    const upsert = delta.upserts.get(item.id);
    kept.push(upsert ?? item);
    if (upsert) {
      placed.add(item.id);
    }
  }
  const added = [...delta.upserts.values()].filter(
    (item) => !placed.has(item.id),
  );
  return added.length ? [...added, ...kept] : kept;
};

export type LibraryItemSummary = {
  id: string;
  name: string | null;
  scope: LibraryScope;
};

export interface LibraryStoreOptions {
  /** Schedules the lazy first load. Default: requestIdleCallback or a timeout. */
  scheduleIdle?: (run: () => void) => void;
}

const defaultScheduleIdle = (run: () => void) => {
  scheduleIdle(globalThis, run, {
    timeout: IDLE_TIMEOUT_MS,
    fallbackMs: IDLE_FALLBACK_MS,
  });
};

export class LibraryStore {
  private personal = newSource("personal", null);
  private vault: Source | null = null;
  /** Ids that belong to the vault file (everything else is personal). */
  private vaultIds = new Set<string>();
  private listeners = new Set<(kind: StoreEventKind) => void>();
  private version = 0;
  private gate: Promise<void> | null = null;
  private openGate: (() => void) | null = null;
  private started = false;
  private unsubscribe: (() => void) | null = null;
  private disposed = false;

  constructor(
    private readonly repo: LibraryRepository,
    private readonly options: LibraryStoreOptions = {},
  ) {}

  // ---- public API --------------------------------------------------------

  /** Resolves when the first load may start (idle, or loadNow was called). */
  ready(): Promise<void> {
    if (!this.gate) {
      this.gate = new Promise<void>((resolve) => {
        this.openGate = resolve;
        (this.options.scheduleIdle ?? defaultScheduleIdle)(resolve);
      });
    }
    return this.gate;
  }

  /** Loads both files now (library sidebar opened, or a save needs them). */
  loadNow(): Promise<void> {
    void this.ready();
    this.openGate?.();
    return this.loadAll();
  }

  /** True once loading was requested (cheap check for hot paths). */
  isStarted() {
    return this.started;
  }

  readonly adapter = {
    load: async (metadata: { source: "load" | "save" }) => {
      if (metadata.source === "save") {
        await this.loadNow();
      } else {
        await this.ready();
        await this.loadAll();
      }
      // everything held here is restored already (parseLibrary / the editor)
      return { libraryItems: this.union(), restored: true };
    },
    save: ({ libraryItems }: { libraryItems: LibraryItems }) => {
      const personal: LibraryItem[] = [];
      const vault: LibraryItem[] = [];
      for (const item of libraryItems) {
        (this.vault && this.vaultIds.has(item.id) ? vault : personal).push(
          item,
        );
      }
      this.setItems(this.personal, personal);
      if (this.vault) {
        this.setItems(this.vault, vault);
      }
    },
  };

  union(): LibraryItem[] {
    return this.vault
      ? [...this.personal.items, ...this.vault.items]
      : [...this.personal.items];
  }

  /**
   * Items for pickers (e.g. a command palette that inserts library items by
   * name): id, name (null when unnamed) and which library holds it. The
   * elements come from `getItem(id)`; inserting goes through the editor.
   */
  listItems(): LibraryItemSummary[] {
    return this.union().map((item) => ({
      id: item.id,
      name: item.name?.trim() || null,
      scope: this.sectionOf(item.id),
    }));
  }

  getItem(id: string): LibraryItem | undefined {
    return (
      this.personal.items.find((item) => item.id === id) ??
      this.vault?.items.find((item) => item.id === id)
    );
  }

  sectionOf = (id: string): LibraryScope =>
    this.vault && this.vaultIds.has(id) ? "vault" : "personal";

  hasVault() {
    return this.vault !== null;
  }

  isVaultReadOnly() {
    return this.vault ? !writable(this.vault) : false;
  }

  /** Human readable problems (unreadable or unwritable library files). */
  getErrors(): string[] {
    const out: string[] = [];
    for (const src of [this.personal, this.vault]) {
      if (src?.error) {
        out.push(
          `${label(src)} could not be read: ${
            src.error
          }; it won't be changed until fixed.`,
        );
      } else if (src?.writeError) {
        out.push(`${label(src)} could not be saved: ${src.writeError}`);
      }
    }
    return out;
  }

  getVersion() {
    return this.version;
  }

  subscribe(fn: (kind: StoreEventKind) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Moves existing items between files, or records where new items go. */
  assign = (ids: readonly string[], scope: LibraryScope) => {
    const target = scope === "vault" ? this.vault : this.personal;
    if (!target || !writable(target)) {
      return;
    }
    const other = target === this.personal ? this.vault : this.personal;
    const idSet = new Set(ids);
    const moving: LibraryItem[] = [];
    if (other && writable(other)) {
      for (const item of other.items) {
        if (idSet.has(item.id)) {
          moving.push(item);
        }
      }
    }
    const inOtherReadOnly = other && !writable(other);
    for (const id of ids) {
      if (inOtherReadOnly && other.items.some((item) => item.id === id)) {
        continue; // cannot move out of an unwritable file
      }
      if (scope === "vault") {
        this.vaultIds.add(id);
      } else {
        this.vaultIds.delete(id);
      }
    }
    if (moving.length && other) {
      const moved = new Set(moving.map((item) => item.id));
      this.setItems(
        other,
        other.items.filter((item) => !moved.has(item.id)),
      );
      this.setItems(target, [...moving, ...target.items]);
    }
    this.bump("ui");
  };

  /** Switches the vault source. The old vault's pending writes are flushed. */
  async setVault(handle: string | null, readOnly = false): Promise<void> {
    const old = this.vault;
    if (old?.handle === handle) {
      if (old && old.hostReadOnly !== readOnly) {
        old.hostReadOnly = readOnly;
        this.bump("ui");
      }
      return;
    }
    if (!old && handle === null) {
      return;
    }
    this.vault = handle ? newSource("vault", handle, readOnly) : null;
    this.vaultIds.clear();
    const fresh = this.vault;
    const flushOld = old ? this.flushSource(old) : Promise.resolve();
    if (old?.loaded || fresh) {
      this.bump("external");
    }
    if (fresh && this.started) {
      await this.loadSource(fresh);
      this.bump("external");
    }
    await flushOld;
  }

  /** Writes any pending changes immediately. Never rejects. */
  async flush(): Promise<void> {
    await Promise.all(
      [this.personal, this.vault].map((src) =>
        src ? this.flushSource(src) : Promise.resolve(),
      ),
    );
  }

  dispose() {
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const src of [this.personal, this.vault]) {
      if (src) {
        this.clearTimers(src);
      }
    }
    this.listeners.clear();
  }

  // ---- loading -----------------------------------------------------------

  private loadAll(): Promise<void> {
    if (!this.started) {
      this.started = true;
      void this.repo
        .subscribe((event) => this.onRepoChange(event))
        .then((unsub) => {
          if (this.disposed) {
            unsub();
          } else {
            this.unsubscribe = unsub;
          }
        })
        .catch(() => {});
    }
    return Promise.all(
      [this.personal, this.vault].map((src) =>
        src ? this.loadSource(src) : Promise.resolve(),
      ),
    ).then(() => {});
  }

  private loadSource(src: Source): Promise<void> {
    if (!src.loading) {
      src.loading = this.run(src, async () => {
        await this.reconcile(src);
        src.loaded = true;
      });
    }
    return src.loading;
  }

  private onRepoChange(event: LibraryChange) {
    const src = event.scope === "personal" ? this.personal : this.vault;
    if (
      !src ||
      !src.loaded ||
      (event.scope === "vault" && event.handle !== src.handle)
    ) {
      return;
    }
    void this.run(src, async () => {
      if (await this.reconcile(src)) {
        this.bump("external");
      }
    });
  }

  /**
   * Reads the file (skipped when the revision is unchanged) and merges the
   * local pending delta on top of it. Returns true when local items changed.
   * `reschedule` is off when `write()` reconciles a conflict: it retries
   * itself, and re-arming the debounce would restart its bounded loop.
   */
  private async reconcile(
    src: Source,
    force = false,
    retryTorn = src.loaded,
    reschedule = true,
  ): Promise<boolean> {
    let result;
    try {
      result = await this.repo.readLibrary(
        src.scope,
        src.handle,
        src.loaded && !force ? src.revision : null,
      );
    } catch (err) {
      src.error = errorMessage(err);
      this.bump("ui");
      return false;
    }
    src.diskReadOnly = result.readOnly;
    if (result.unchanged) {
      return false;
    }
    let disk: LibraryItem[] = [];
    if (result.json !== null) {
      try {
        disk = await parseLibrary(result.json);
      } catch (err) {
        if (retryTorn) {
          // Sync tools can expose half-written files: look once more.
          await new Promise((resolve) => setTimeout(resolve, TORN_RETRY_MS));
          return this.reconcile(src, true, false, reschedule);
        }
        src.error = errorMessage(err);
        src.revision = result.revision;
        this.bump("ui");
        return false;
      }
    }
    if (src.error) {
      src.error = null;
      this.bump("ui");
    }
    const pending = writable(src) ? pendingDelta(src) : null;
    const next = pending ? applyDelta(disk, pending) : disk;
    const nextSigs = sigsOf(next);
    const changed = !sameSigs(nextSigs, src.sigs);
    src.base = new Map(sigsOf(disk).map((sig, i) => [disk[i].id, sig]));
    src.revision = result.revision;
    src.existed = result.json !== null || result.revision !== null;
    src.items = next;
    src.sigs = nextSigs;
    if (src.scope === "vault") {
      for (const item of next) {
        this.vaultIds.add(item.id);
      }
    }
    if (reschedule && pendingDelta(src)) {
      this.schedule(src);
    }
    return changed;
  }

  // ---- writing -----------------------------------------------------------

  private setItems(src: Source, items: LibraryItem[]) {
    const sigs = sigsOf(items);
    if (sameSigs(sigs, src.sigs)) {
      return;
    }
    src.items = items;
    src.sigs = sigs;
    if (writable(src)) {
      this.schedule(src);
    }
  }

  private schedule(src: Source) {
    if (this.disposed || !writable(src)) {
      return;
    }
    if (src.debounce) {
      clearTimeout(src.debounce);
    }
    src.debounce = setTimeout(() => this.fire(src), WRITE_DEBOUNCE_MS);
    if (!src.maxWait) {
      src.maxWait = setTimeout(() => this.fire(src), WRITE_MAX_WAIT_MS);
    }
  }

  private clearTimers(src: Source) {
    if (src.debounce) {
      clearTimeout(src.debounce);
    }
    if (src.maxWait) {
      clearTimeout(src.maxWait);
    }
    src.debounce = src.maxWait = null;
  }

  private fire(src: Source) {
    this.clearTimers(src);
    void this.run(src, () => this.write(src));
  }

  private flushSource(src: Source): Promise<void> {
    this.clearTimers(src);
    return this.run(src, () => this.write(src)).then(() => {});
  }

  /** Serialises all I/O of one source; never rejects. */
  private run<T>(src: Source, fn: () => Promise<T>): Promise<T | undefined> {
    const next = src.queue.then(fn, fn).catch((err) => {
      console.error("library operation failed", err);
      return undefined;
    });
    src.queue = next;
    return next;
  }

  private async write(src: Source) {
    for (let attempt = 0; attempt <= MAX_CONFLICT_RETRIES; attempt++) {
      if (!src.loaded || !writable(src) || !pendingDelta(src)) {
        return;
      }
      // Never create an empty library file.
      if (!src.existed && src.items.length === 0) {
        return;
      }
      const items = src.items;
      const sigs = src.sigs;
      try {
        const { revision } = await this.repo.writeLibrary(
          src.scope,
          src.handle,
          await serializeLibrary(items),
          src.existed ? src.revision : null,
        );
        src.revision = revision;
        src.existed = true;
        src.base = new Map(sigs.map((sig, i) => [items[i].id, sig]));
        if (src.writeError) {
          src.writeError = null;
          this.bump("ui");
        }
        if (pendingDelta(src)) {
          this.schedule(src); // edits arrived while writing
        }
        return;
      } catch (err) {
        if ((err as { code?: string })?.code === "CONFLICT") {
          if (await this.reconcile(src, true, src.loaded, false)) {
            this.bump("external");
          }
          continue;
        }
        src.writeError = errorMessage(err);
        this.bump("ui");
        return;
      }
    }
    src.writeError = "the file keeps changing on disk";
    this.bump("ui");
  }

  private bump(kind: StoreEventKind) {
    this.version++;
    for (const fn of [...this.listeners]) {
      fn(kind);
    }
  }
}
