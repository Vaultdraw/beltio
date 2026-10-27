/**
 * The activity bar's slots. Built-ins (entries.ts) and later plugins register
 * the same way; an entry's `group` picks the slot. The combined list is
 * top then bottom, the order layout.ts resolves over.
 */
import { useMemo } from "react";

import { createSlotRegistry } from "../slots/slotRegistry";
import { useSlot } from "../slots/useSlot";

import { hasShownActivityEntry } from "./layout";

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

/** Moves each entry that names an `after` id to just behind it (kept at the end when that id is absent). */
export function placeAfter(
  list: readonly ActivityEntry[],
): readonly ActivityEntry[] {
  if (!list.some((e) => e.after)) {
    return list;
  }
  const out = list.filter((e) => !e.after);
  for (const e of list.filter((x) => x.after)) {
    const at = out.findIndex((x) => x.id === e.after);
    out.splice(at < 0 ? out.length : at + 1, 0, e);
  }
  return out;
}

export function useActivityEntries(): readonly ActivityEntry[] {
  const top = useSlot(activityBarRegistry, "activityBar.top");
  const bottom = useSlot(activityBarRegistry, "activityBar.bottom");
  return useMemo(() => placeAfter([...top, ...bottom]), [top, bottom]);
}

/** The rail shows when it is on and some entry is not hidden by the user. */
export function useActivityBarShown(
  on: boolean,
  hidden: readonly string[],
): boolean {
  const entries = useActivityEntries();
  return on && hasShownActivityEntry(entries, hidden);
}
