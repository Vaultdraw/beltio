/**
 * The activity bar's slots. Built-ins (entries.ts) and later plugins register
 * the same way; an entry's `group` picks the slot. The combined list is
 * top then bottom, the order layout.ts resolves over.
 */
import { useMemo } from "react";

import { createSlotRegistry } from "../slots/slotRegistry";
import { useSlot } from "../slots/useSlot";

import type { ActivityEntry } from "./entries";

export const ACTIVITY_SLOTS = [
  "activityBar.top",
  "activityBar.bottom",
] as const;
export type ActivitySlot = typeof ACTIVITY_SLOTS[number];

export const activityBarRegistry = createSlotRegistry<
  ActivityEntry,
  ActivitySlot
>(ACTIVITY_SLOTS);

const slotOf = (entry: ActivityEntry): ActivitySlot =>
  entry.group === "top" ? "activityBar.top" : "activityBar.bottom";

/** Registers entries into the slot of their group; returns one disposer. */
export function registerActivityEntries(
  entries: readonly ActivityEntry[],
): () => void {
  const disposers = ACTIVITY_SLOTS.map((slot) =>
    activityBarRegistry.register(
      slot,
      entries.filter((e) => slotOf(e) === slot),
    ),
  );
  return () => disposers.forEach((d) => d());
}

export function useActivityEntries(): readonly ActivityEntry[] {
  const top = useSlot(activityBarRegistry, "activityBar.top");
  const bottom = useSlot(activityBarRegistry, "activityBar.bottom");
  return useMemo(() => [...top, ...bottom], [top, bottom]);
}
