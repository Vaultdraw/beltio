import { useSyncExternalStore } from "react";

import type { SlotRegistry } from "./slotRegistry";

/** The live contributions of one slot; re-renders only when the slot changes. */
export function useSlot<T extends { id: string }, S extends string>(
  registry: SlotRegistry<T, S>,
  slot: S,
): readonly T[] {
  return useSyncExternalStore(
    registry.subscribe,
    () => registry.list(slot),
    () => registry.list(slot),
  );
}
