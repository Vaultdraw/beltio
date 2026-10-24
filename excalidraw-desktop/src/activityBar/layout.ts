/**
 * Which activity bar entries show, and in what order. Pure: the settings
 * (`interface.activity_bar_order` / `activity_bar_hidden`) are two id lists.
 * Unknown ids are ignored; entries missing from the order keep their default
 * place after the listed ones, so a future entry still appears.
 * A `defaultHidden` entry shows only once `+<id>` is in the hidden list (the
 * user switched it on); `<id>` in the list always hides.
 */
import type { ActivityEntry } from "./entries";

/** Hidden-list prefix: a defaultHidden entry the user switched on. */
const SHOWN = "+";

export interface LayoutRow {
  entry: ActivityEntry;
  hidden: boolean;
}

export function resolveActivityLayout(
  entries: readonly ActivityEntry[],
  order: readonly string[],
  hidden: readonly string[],
): LayoutRow[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const seen = new Set<string>();
  const ordered: ActivityEntry[] = [];
  for (const id of order) {
    const entry = byId.get(id);
    if (entry && !seen.has(id)) {
      seen.add(id);
      ordered.push(entry);
    }
  }
  for (const entry of entries) {
    if (!seen.has(entry.id)) {
      ordered.push(entry);
    }
  }
  const hide = new Set(hidden);
  return ordered.map((entry) => ({
    entry,
    hidden:
      hide.has(entry.id) ||
      (entry.defaultHidden === true && !hide.has(SHOWN + entry.id)),
  }));
}

/**
 * The order after moving `id` one step up or down among the entries of its
 * own group (the bar keeps top and bottom groups apart). Returns the full
 * resolved id list; unchanged at an end.
 */
export function moveActivityEntry(
  entries: readonly ActivityEntry[],
  order: readonly string[],
  id: string,
  direction: -1 | 1,
): string[] {
  const ids = resolveActivityLayout(entries, order, []).map((r) => r.entry.id);
  const group = (x: string) => entries.find((e) => e.id === x)?.group;
  const from = ids.indexOf(id);
  if (from < 0) {
    return ids;
  }
  let to = from + direction;
  while (to >= 0 && to < ids.length && group(ids[to]) !== group(id)) {
    to += direction;
  }
  if (to < 0 || to >= ids.length) {
    return ids;
  }
  [ids[from], ids[to]] = [ids[to], ids[from]];
  return ids;
}

/** `id` shown or hidden; the list stays free of duplicates and unknown ids. */
export function setActivityEntryHidden(
  entries: readonly ActivityEntry[],
  hidden: readonly string[],
  id: string,
  hide: boolean,
): string[] {
  const rest = hidden.filter((x) => x !== id && x !== SHOWN + id);
  const entry = entries.find((e) => e.id === id);
  // A defaultHidden entry is hidden by absence; only "show" needs a marker.
  const mark = entry?.defaultHidden
    ? hide
      ? null
      : SHOWN + id
    : hide
    ? id
    : null;
  const next = mark ? [...rest, mark] : rest;
  const known = new Set(entries.flatMap((e) => [e.id, SHOWN + e.id]));
  return next.filter((x) => known.has(x));
}

/**
 * Whether the rail is worth mounting: the user's hidden list must not cover
 * every registered entry. Command availability is ignored on purpose (handlers
 * register late; it must not make the rail flicker in).
 */
export function hasShownActivityEntry(
  entries: readonly ActivityEntry[],
  hidden: readonly string[],
): boolean {
  if (entries.length === 0) {
    return true;
  }
  const hide = new Set(hidden);
  return entries.some(
    (e) =>
      !hide.has(e.id) && !(e.defaultHidden === true && !hide.has(SHOWN + e.id)),
  );
}
