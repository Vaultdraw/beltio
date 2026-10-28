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

  const load = async () => {
    try {
      const table = await ctx.vault.table.read();
      items = parseItems(table.items);
    } catch {
      items = []; // no vault open, or no permission: an empty list
    }
    emit();
  };

  const save = async () => {
    const value = serialize(items);
    try {
      await ctx.vault.table.update([
        { key: "items", value: value.length ? value : null },
      ]);
    } catch (e) {
      ctx.ui.toast("Could not save favourites");
      ctx.log.warn(e instanceof Error ? e.message : String(e));
    }
  };

  const ready = () => (loaded ??= load());

  return {
    get: () => items,
    subscribe(l) {
      listeners.add(l);
      void ready();
      return () => listeners.delete(l);
    },
    reload() {
      loaded = load();
      return loaded;
    },
    set(next) {
      items = next;
      emit();
      chain = chain.then(save);
      return chain;
    },
    async update(change) {
      await ready();
      return this.set(change(items));
    },
  };
}
