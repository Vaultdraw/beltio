/**
 * The favourites of the open vault: loaded from the plugin's own settings table
 * (`ctx.vault.table`, `[favourites]` of settings.toml), changed in memory first and written
 * back one change at a time. Components read it with `useSyncExternalStore`.
 */
import { parseItems, serialize, type Favourite } from "./model";

import type { PluginContext } from "@vaultdraw/api";

export interface FavouritesStore {
  get(): readonly Favourite[];
  subscribe(listener: () => void): () => void;
  /** Reads the table again (vault switched, or the file was edited by hand). */
  reload(): Promise<void>;
  /** Resolves once the changes asked for so far (renames replayed at activation too) are applied and saved. */
  settled(): Promise<void>;
  /** Replaces the list and saves it. */
  set(next: readonly Favourite[]): Promise<void>;
  /** Applies `change` to the latest list (after the first load) and saves it. */
  update(
    change: (items: readonly Favourite[]) => readonly Favourite[],
  ): Promise<void>;
}

export function createStore(ctx: PluginContext): FavouritesStore {
  let items: readonly Favourite[] = [];
  let loaded: Promise<void> | null = null;
  let chain: Promise<void> = Promise.resolve();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());

  // Set when the last read failed: the list is then unknown, not empty, so it must never be saved.
  let loadFailed = false;
  // Bumped when another vault opens: a save queued before that belongs to the old vault.
  let generation = 0;
  ctx.subscriptions.push(
    ctx.events.on("vault.opened", () => {
      generation++;
    }),
  );

  const load = async () => {
    try {
      const table = await ctx.vault.table.read();
      items = parseItems(table.items);
      loadFailed = false;
    } catch {
      items = []; // no vault open, or no permission: shown empty, but never saved
      loadFailed = true;
    }
    emit();
  };

  const save = async (value: ReturnType<typeof serialize>, gen: number) => {
    if (gen !== generation) {
      return; // the vault changed since this change was made
    }
    try {
      await ctx.vault.table.update([
        { key: "items", value: value.length ? value : null },
      ]);
    } catch (e) {
      ctx.ui.toast("Could not save favourites");
      ctx.log.warn(e instanceof Error ? e.message : String(e));
    }
  };

  const commit = async (next: readonly Favourite[], gen: number) => {
    if (loadFailed) {
      // `next` was built on an unknown list; `reload()` (next vault.opened, toggle, jump) retries the read.
      ctx.ui.toast("Favourites could not be read; not saving");
      return;
    }
    if (gen !== generation) {
      return; // another vault opened since the change was made
    }
    items = next;
    emit();
    const value = serialize(items);
    chain = chain.then(() => save(value, gen));
    return chain;
  };

  const inflight = new Set<Promise<void>>();

  const ready = () => (loaded ??= load());

  return {
    get: () => items,
    subscribe(l) {
      listeners.add(l);
      void ready();
      return () => listeners.delete(l);
    },
    async reload() {
      await this.settled();
      loaded = load();
      return loaded;
    },
    async settled() {
      // Events the host replays at activation are queued on a microtask: give them a turn first.
      await new Promise((r) => setTimeout(r, 0));
      while (inflight.size > 0) {
        await Promise.all([...inflight]);
      }
      await chain;
    },
    set(next) {
      return commit(next, generation);
    },
    update(change) {
      const gen = generation; // the vault this change was made in
      const run = (async () => {
        await ready();
        if (loadFailed) {
          await load(); // one more try before giving up
        }
        if (loadFailed) {
          ctx.ui.toast("Favourites could not be read; not saving");
          return;
        }
        await commit(change(items), gen);
      })();
      inflight.add(run);
      const done = () => void inflight.delete(run);
      void run.then(done, done);
      return run;
    },
  };
}
