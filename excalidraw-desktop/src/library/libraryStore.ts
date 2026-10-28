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
  /** Section id in the panel: "personal", "vault" or `lib:<scope>:<handle>:<name>`. */
  id: string;
  scope: LibraryScope;
  handle: string | null;
  /** File stem of a named library; null for the default file of a scope. */
  name: string | null;
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

const sourceId = (
  scope: LibraryScope,
  handle: string | null,
  name: string | null,
) =>
  name === null
    ? scope
    : `lib:${scope}:${scope === "personal" ? "" : handle ?? ""}:${name}`;

const newSource = (
  scope: LibraryScope,
  handle: string | null,
  hostReadOnly = false,
  name: string | null = null,
): Source => ({
  id: sourceId(scope, handle, name),
  scope,
  handle,
  name,
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
  src.name !== null
    ? `The library "${src.name}"`
    : src.scope === "vault"
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
  /** Section id of the library that holds the item. */
  scope: string;
  /** Display name of that library. */
  library: string;
};

export type LibrarySectionInfo = {
  id: string;
  label: string;
  scope: LibraryScope;
  /** File stem for named libraries (rename/remove work on these). */
  name: string | null;
  readOnly: boolean;
};

/** Where new items land when no section is chosen (`[library] default`). */
const DEFAULT_PERSONAL = "personal";

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
  /** Named libraries (config `libraries/`, vault `libraries/`, extra folders). */
  private extras: Source[] = [];
  /** Extra folders from `[library] folders`. */
  private folders: string[] = [];
  /** `[library] default`: name of the library that takes new items. */
  private defaultName = "";
  /** Ids that belong to the vault file (everything else is personal). */
  private vaultIds = new Set<string>();
  /** Ids that belong to a named library. */
  private extraIds = new Map<string, Source>();
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
      const buckets = new Map<Source, LibraryItem[]>(
        this.sources().map((src) => [src, []]),
      );
      const known = new Set(this.personal.items.map((item) => item.id));
      const fallback = this.defaultSource();
      for (const item of libraryItems) {
        buckets.get(this.ownerOf(item.id, known, fallback))?.push(item);
      }
      for (const [src, items] of buckets) {
        for (const { id } of items) {
          // new items stay where they were put
          if (src.name !== null) {
            this.extraIds.set(id, src);
          } else if (src.scope === "vault") {
            this.vaultIds.add(id);
          }
        }
        this.setItems(src, items);
      }
    },
  };

  /** Every source in panel order: personal, this vault, then named ones. */
  private sources(): Source[] {
    return [
      this.personal,
      ...(this.vault ? [this.vault] : []),
      ...this.extras,
    ];
  }

  private defaultSource(): Source {
    const name = this.defaultName.trim();
    if (!name || name.toLowerCase() === DEFAULT_PERSONAL) {
      return this.personal;
    }
    if (name.toLowerCase() === "vault" && this.vault) {
      return this.vault;
    }
    return (
      this.extras.find((src) => src.name?.toLowerCase() === name.toLowerCase()) ??
      this.personal
    );
  }

  /** The source an item lives in; ids nobody holds yet go to the default. */
  private ownerOf(
    id: string,
    personalIds: ReadonlySet<string>,
    fallback: Source,
  ): Source {
    const extra = this.extraIds.get(id);
    if (extra) {
      return extra;
    }
    if (this.vault && this.vaultIds.has(id)) {
      return this.vault;
    }
    return personalIds.has(id) ? this.personal : fallback;
  }

  union(): LibraryItem[] {
    return this.sources().flatMap((src) => src.items);
  }

  /**
   * Items for pickers (e.g. a command palette that inserts library items by
   * name): id, name (null when unnamed) and which library holds it. The
   * elements come from `getItem(id)`; inserting goes through the editor.
   */
  listItems(): LibraryItemSummary[] {
    return this.sources().flatMap((src) =>
      src.items.map((item) => ({
        id: item.id,
        name: item.name?.trim() || null,
        scope: src.id,
        library: this.displayName(src),
      })),
    );
  }

  getItem(id: string): LibraryItem | undefined {
    for (const src of this.sources()) {
      const found = src.items.find((item) => item.id === id);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  sectionOf = (id: string): string => {
    const extra = this.extraIds.get(id);
    if (extra) {
      return extra.id;
    }
    return this.vault && this.vaultIds.has(id) ? "vault" : "personal";
  };

  private displayName(src: Source): string {
    if (src.name !== null) {
      return src.name;
    }
    return src.scope === "vault" ? "This vault" : "Personal";
  }

  /** Sections for the panel, in order (named libraries after the two defaults). */
  getSections(): LibrarySectionInfo[] {
    return this.sources().map((src) => ({
      id: src.id,
      label: this.displayName(src),
      scope: src.scope,
      name: src.name,
      readOnly: !writable(src),
    }));
  }

  sourceInfo(sectionId: string): LibrarySectionInfo | undefined {
    return this.getSections().find((section) => section.id === sectionId);
  }

  hasVault() {
    return this.vault !== null;
  }

  isVaultReadOnly() {
    return this.vault ? !writable(this.vault) : false;
  }

  /** Human readable problems (unreadable or unwritable library files). */
  getErrors(): string[] {
    const out: string[] = [];
    for (const src of this.sources()) {
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

  /** Moves existing items between libraries, or records where new items go. */
  assign = (ids: readonly string[], sectionId: string) => {
    const target = this.sources().find((src) => src.id === sectionId);
    if (!target || !writable(target)) {
      return;
    }
    const idSet = new Set(ids);
    // Items held by another writable source move over; ones in an unwritable
    // file stay (they cannot be taken out of it).
    const moving: LibraryItem[] = [];
    for (const other of this.sources()) {
      if (other === target) {
        continue;
      }
      const hit = other.items.filter((item) => idSet.has(item.id));
      if (!hit.length) {
        continue;
      }
      if (!writable(other)) {
        for (const item of hit) {
          idSet.delete(item.id);
        }
        continue;
      }
      const gone = new Set(hit.map((item) => item.id));
      moving.push(...hit);
      this.setItems(
        other,
        other.items.filter((item) => !gone.has(item.id)),
      );
    }
    for (const id of idSet) {
      this.vaultIds.delete(id);
      this.extraIds.delete(id);
      if (target.scope === "vault" && target.name === null) {
        this.vaultIds.add(id);
      } else if (target.name !== null) {
        this.extraIds.set(id, target);
      }
    }
    if (moving.length) {
      this.setItems(target, [...moving, ...target.items]);
    }
    this.bump("ui");
  };

  // ---- named libraries ---------------------------------------------------

  /** Applies `[library] folders` and `default`; reloads the list when they change. */
  async configure(folders: readonly string[], defaultName: string) {
    const nextFolders = [...folders];
    const changed =
      nextFolders.join("\n") !== this.folders.join("\n") ||
      defaultName !== this.defaultName;
    this.folders = nextFolders;
    this.defaultName = defaultName;
    if (changed && this.started) {
      await this.refreshLibraries();
    }
  }

  async createLibrary(scope: LibraryScope, name: string): Promise<void> {
    const handle = this.handleFor(scope);
    await this.repo.createLibrary?.(scope, handle, name);
    await this.refreshLibraries();
  }

  async renameLibrary(sectionId: string, newName: string): Promise<void> {
    const src = this.extras.find((s) => s.id === sectionId);
    if (!src || src.name === null) {
      return;
    }
    await this.flushSource(src);
    await this.repo.renameLibrary?.(src.scope, src.handle, src.name, newName);
    await this.refreshLibraries();
  }

  async removeLibrary(sectionId: string): Promise<void> {
    const src = this.extras.find((s) => s.id === sectionId);
    if (!src || src.name === null) {
      return;
    }
    this.clearTimers(src);
    await this.repo.deleteLibrary?.(src.scope, src.handle, src.name);
    await this.refreshLibraries();
  }

  /** Re-reads the list and the files of the named libraries (window focus). */
  refresh(): Promise<void> {
    return this.started ? this.refreshLibraries() : Promise.resolve();
  }

  /** Native file picker for importing a library (host side of the panel). */
  pickLibraryFile() {
    return this.repo.pickLibraryFile();
  }

  private handleFor(scope: LibraryScope): string | null {
    if (scope === "vault") {
      return this.vault?.handle ?? null;
    }
    return null;
  }

  /** The (scope, handle) pairs that can hold named libraries. */
  private containers(): { scope: LibraryScope; handle: string | null }[] {
    return [
      { scope: "personal" as const, handle: null },
      ...(this.vault
        ? [{ scope: "vault" as const, handle: this.vault.handle }]
        : []),
      ...this.folders.map((handle) => ({ scope: "folder" as const, handle })),
    ];
  }

  /**
   * Lists the named libraries on disk and brings `extras` in line: new files
   * load, vanished ones drop their items. Cheap when nothing changed.
   */
  private async refreshLibraries(only?: LibraryChange): Promise<void> {
    if (!this.repo.listLibraries || this.disposed) {
      return;
    }
    const listed: Source[] = [];
    let changed = false;
    for (const { scope, handle } of this.containers()) {
      if (
        only &&
        (only.scope !== scope ||
          (scope !== "personal" && only.handle !== handle))
      ) {
        // untouched container: keep its sources as they are
        listed.push(
          ...this.extras.filter(
            (src) => src.scope === scope && src.handle === handle,
          ),
        );
        continue;
      }
      let names: string[] = [];
      try {
        names = await this.repo.listLibraries(scope, handle);
      } catch {
        names = [];
      }
      for (const name of names) {
        const id = sourceId(scope, handle, name);
        const existing = this.extras.find((src) => src.id === id);
        if (existing) {
          listed.push(existing);
        } else {
          const hostReadOnly = scope === "vault" ? this.vault?.hostReadOnly : false;
          listed.push(newSource(scope, handle, hostReadOnly ?? false, name));
          changed = true;
        }
      }
    }
    const keep = new Set(listed.map((src) => src.id));
    for (const old of this.extras) {
      if (!keep.has(old.id)) {
        this.clearTimers(old);
        for (const [id, owner] of this.extraIds) {
          if (owner === old) {
            this.extraIds.delete(id);
          }
        }
        changed = true;
      }
    }
    this.extras = listed;
    await Promise.all(this.extras.map((src) => this.loadSource(src)));
    // pick up outside edits of libraries that were already loaded
    const reloaded = await Promise.all(
      this.extras.map((src) => this.run(src, () => this.reconcile(src))),
    );
    if (changed || reloaded.some(Boolean)) {
      this.bump("external");
    }
  }

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
    for (const src of this.extras) {
      if (src.scope === "vault") {
        this.clearTimers(src);
      }
    }
    for (const [id, owner] of this.extraIds) {
      if (owner.scope === "vault") {
        this.extraIds.delete(id);
      }
    }
    this.extras = this.extras.filter((src) => src.scope !== "vault");
    const fresh = this.vault;
    const flushOld = old ? this.flushSource(old) : Promise.resolve();
    if (old?.loaded || fresh) {
      this.bump("external");
    }
    if (fresh && this.started) {
      await this.loadSource(fresh);
      await this.refreshLibraries({ scope: "vault", handle: fresh.handle ?? undefined });
      this.bump("external");
    }
    await flushOld;
  }

  /** Writes any pending changes immediately. Never rejects. */
  async flush(): Promise<void> {
    await Promise.all(
      this.sources().map((src) => this.flushSource(src)),
    );
  }

  dispose() {
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const src of this.sources()) {
      this.clearTimers(src);
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
    )
      .then(() => this.refreshLibraries())
      .then(() => {});
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
    if (this.started) {
      void this.refreshLibraries(event).catch(() => {});
    }
    const src = event.scope === "personal" ? this.personal : this.vault;
    if (
      !src ||
      !src.loaded ||
      event.scope === "folder" ||
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
        src.name,
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
    if (src.scope === "vault" && src.name === null) {
      for (const item of next) {
        this.vaultIds.add(item.id);
      }
    } else if (src.name !== null) {
      for (const item of next) {
        this.extraIds.set(item.id, src);
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
          src.name,
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
