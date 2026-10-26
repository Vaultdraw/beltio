/**
 * `ctx.storage.global`: one JSON object per plugin, kept in memory as JSON
 * text per key and written whole through the gateway (`storage.write`).
 *
 * - Lazy: nothing is read until the first call, nothing written until a change.
 * - Writes are debounced 600 ms with a 2 s maximum wait (the library store's
 *   constants), skipped when the text is unchanged, one at a time.
 * - Flushed on dispose and in the quit barrier (`flushAllPluginStorage`).
 * - A corrupt file was renamed `data.json.bad` by Rust: the plugin starts
 *   empty, with one log line and one toast.
 */
import {
  STORAGE_DEFAULT_LIMIT_KB,
  checkStorageKey,
  checkStorageQuota,
  composeStorage,
  encodeStorageValue,
  storageEntryBytes,
} from "../../../../sdk/api/shared/rules";

import type { Json, StorageScope } from "../api";

export const STORAGE_DEBOUNCE_MS = 600;
export const STORAGE_MAX_WAIT_MS = 2000;
/** `{}` around the entries. */
const BRACES = 2;

export interface StorageIO {
  read(): Promise<{ data: Record<string, Json> | null; corrupt: boolean }>;
  write(text: string): Promise<void>;
}

export interface StorageDeps {
  io: StorageIO;
  limitKb(): number;
  onCorrupt(): void;
  onWriteError(err: unknown): void;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  now(): number;
}

export interface PluginStore extends StorageScope {
  /** Writes pending changes now; resolves when the disk has them (or the write failed). */
  flush(): Promise<void>;
  /** Forgets everything in memory and any pending write. */
  reset(): void;
  /**
   * "Delete data": drops memory and the pending write, waits for a write
   * already sent, then runs `remove` (the native delete). Calls made meanwhile
   * wait and then start from the empty store.
   */
  wipe<T>(remove: () => Promise<T>): Promise<T>;
}

export function createPluginStore(deps: StorageDeps): PluginStore {
  let entries: Map<string, string> | null = null;
  let bytes = BRACES;
  let loading: Promise<Map<string, string>> | null = null;
  let generation = 0;
  /** Text on disk (as far as we know); null before the first load. */
  let written: string | null = null;
  let dirty = false;
  let timer: unknown = null;
  let firstChangeAt = 0;
  let writing: Promise<void> = Promise.resolve();
  /** Set while "Delete data" runs: loads wait, so the old file is never read back. */
  let wiping: Promise<void> | null = null;

  const load = (): Promise<Map<string, string>> => {
    if (entries) {
      return Promise.resolve(entries);
    }
    if (wiping) {
      return wiping.then(load, load);
    }
    if (!loading) {
      const gen = generation;
      loading = deps.io.read().then(
        ({ data, corrupt }) => {
          if (gen !== generation) {
            return load();
          }
          const map = new Map<string, string>();
          let size = BRACES;
          for (const [k, v] of Object.entries(data ?? {})) {
            const text = JSON.stringify(v);
            map.set(k, text);
            size += storageEntryBytes(k, text);
          }
          entries = map;
          bytes = size;
          written = data ? composeStorage(map) : "{}";
          if (corrupt) {
            written = null; // Rust renamed the file: the next change must write.
            deps.onCorrupt();
          }
          return map;
        },
        (err) => {
          if (gen === generation) {
            loading = null;
          }
          throw err;
        },
      );
    }
    return loading;
  };

  const cancelTimer = () => {
    if (timer !== null) {
      deps.clearTimer(timer);
      timer = null;
    }
  };

  const writeNow = (): Promise<void> => {
    cancelTimer();
    if (!dirty || !entries) {
      return writing;
    }
    dirty = false;
    const text = composeStorage(entries);
    if (text === written) {
      return writing;
    }
    const gen = generation;
    writing = writing
      .then(() => (gen === generation ? deps.io.write(text) : undefined))
      .then(
        () => {
          if (gen === generation) {
            written = text;
          }
          notifyWritten();
        },
        (err) => {
          if (gen === generation) {
            dirty = true; // Kept in memory: the next change or flush retries.
          }
          deps.onWriteError(err);
        },
      );
    return writing;
  };

  const schedule = () => {
    const now = deps.now();
    if (!dirty) {
      firstChangeAt = now;
    }
    dirty = true;
    cancelTimer();
    const wait = Math.min(
      STORAGE_DEBOUNCE_MS,
      Math.max(0, firstChangeAt + STORAGE_MAX_WAIT_MS - now),
    );
    timer = deps.setTimer(() => {
      timer = null;
      void writeNow();
    }, wait);
  };

  function reset() {
    generation++;
    cancelTimer();
    entries = null;
    loading = null;
    bytes = BRACES;
    written = null;
    dirty = false;
  }

  return {
    async get<T extends Json = Json>(key: string) {
      checkStorageKey(key);
      const text = (await load()).get(key);
      return text === undefined ? undefined : (JSON.parse(text) as T);
    },
    async set(key, value) {
      checkStorageKey(key);
      const text = encodeStorageValue(key, value);
      const map = await load();
      const old = map.get(key);
      if (old === text) {
        return;
      }
      const next =
        bytes -
        (old === undefined ? 0 : storageEntryBytes(key, old)) +
        storageEntryBytes(key, text);
      // `bytes` counts a comma after every entry; the stored object has one less.
      checkStorageQuota(next - 1, deps.limitKb());
      map.set(key, text);
      bytes = next;
      schedule();
    },
    async delete(key) {
      checkStorageKey(key);
      const map = await load();
      const old = map.get(key);
      if (old === undefined) {
        return;
      }
      map.delete(key);
      bytes -= storageEntryBytes(key, old);
      schedule();
    },
    async keys() {
      return [...(await load()).keys()];
    },
    flush: () => writeNow(),
    reset,
    wipe(remove) {
      reset();
      const inFlight = writing;
      const run = inFlight.then(remove, remove);
      const gate = run.then(
        () => undefined,
        () => undefined,
      );
      wiping = gate;
      void gate.then(() => {
        if (wiping === gate) {
          wiping = null;
        }
      });
      return run;
    },
  };
}

// --- one store per plugin id, shared by every ctx of that plugin, for flush and delete ---

const stores = new Map<string, PluginStore>();

export const getPluginStore = (
  id: string,
  make: () => PluginStore,
): PluginStore => {
  let s = stores.get(id);
  if (!s) {
    s = make();
    stores.set(id, s);
  }
  return s;
};

/** The quit barrier: every pending write reaches the disk (failures are already reported). */
export const flushAllPluginStorage = async (): Promise<void> => {
  await Promise.all([...stores.values()].map((s) => s.flush()));
};

/** Tests and the kit's `seed`: forget what is in memory. */
export const resetPluginStore = (id: string): void => {
  stores.get(id)?.reset();
};

/** "Delete data" for `id`: through its store when it has one, so nothing writes the old data back. */
export const wipePluginStore = <T>(
  id: string,
  remove: () => Promise<T>,
): Promise<T> => {
  const s = stores.get(id);
  const run = s ? s.wipe(remove) : remove();
  return run.finally(notifyWritten);
};

const writeListeners = new Set<() => void>();

function notifyWritten(): void {
  writeListeners.forEach((fn) => fn());
}

/** Called after a plugin's data reached the disk or was deleted (Settings refreshes sizes). */
export const subscribeStorageWrites = (fn: () => void): (() => void) => {
  writeListeners.add(fn);
  return () => void writeListeners.delete(fn);
};

export const pluginStoreCount = (): number => stores.size;

/** Tests. */
export const clearPluginStores = (): void => {
  stores.forEach((s) => s.reset());
  stores.clear();
};

export const limitKbOr = (value: unknown): number =>
  typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : STORAGE_DEFAULT_LIMIT_KB;
