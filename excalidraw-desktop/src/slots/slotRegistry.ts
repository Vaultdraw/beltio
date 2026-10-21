/**
 * A generic, framework-free registry of contributions to named slots (the
 * activity bar's top/bottom groups, later more). Built-ins and plugins
 * register the same way; order is registration order, and the first owner of
 * an id keeps it. `list` is a cached snapshot, so it is safe to feed React's
 * useSyncExternalStore (see useSlot).
 */
export interface SlotRegistry<T extends { id: string }, S extends string> {
  /** Adds `items` to `slot`; returns a disposer that removes exactly these. */
  register(slot: S, items: readonly T[]): () => void;
  /** Same array reference until the slot changes. */
  list(slot: S): readonly T[];
  /** Bumps on every change, in any slot. */
  version(): number;
  subscribe(listener: () => void): () => void;
}

export function createSlotRegistry<T extends { id: string }, S extends string>(
  slots: readonly S[],
): SlotRegistry<T, S> {
  const known = new Set<string>(slots);
  const lists = new Map<S, readonly T[]>(slots.map((s) => [s, []]));
  const ids = new Set<string>();
  const listeners = new Set<() => void>();
  let version = 0;

  return {
    register(slot, items) {
      if (!known.has(slot)) {
        console.warn(`slots: unknown slot "${slot}"`);
        return () => {};
      }
      const added = items.filter((item) => {
        if (ids.has(item.id)) {
          console.warn(`slots: duplicate id "${item.id}" refused`);
          return false;
        }
        ids.add(item.id);
        return true;
      });
      if (added.length === 0) {
        return () => {};
      }
      lists.set(slot, [...lists.get(slot)!, ...added]);
      version++;
      listeners.forEach((l) => l());
      let disposed = false;
      return () => {
        if (disposed) {
          return;
        }
        disposed = true;
        added.forEach((item) => ids.delete(item.id));
        lists.set(
          slot,
          lists.get(slot)!.filter((x) => !added.includes(x)),
        );
        version++;
        listeners.forEach((l) => l());
      };
    },
    list: (slot) => lists.get(slot) ?? [],
    version: () => version,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
