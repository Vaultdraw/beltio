/** Pure view logic of the Hotkeys page: filters, counts, grouping, conflict text. */
import { formatKeyLabel } from "../../../palette/shortcuts";
import { foldKey } from "../../../search/foldKey";

import type { Conflict } from "../../../commands/conflicts";
import type {
  Chord,
  CommandDefinition,
  Platform,
} from "../../../commands/types";

export type FilterId =
  | "all"
  | "assigned"
  | "customised"
  | "unassigned"
  | "conflicts";

export const FILTERS: readonly { id: FilterId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "assigned", label: "Assigned" },
  { id: "customised", label: "Customised" },
  { id: "unassigned", label: "Unassigned" },
  { id: "conflicts", label: "Conflicts" },
];

/** What the page needs to know about one command, computed once per change. */
export interface HotkeyInfo {
  command: CommandDefinition;
  keys: Chord[];
  customised: boolean;
  conflicted: boolean;
}

export const matchesFilter = (info: HotkeyInfo, filter: FilterId): boolean => {
  switch (filter) {
    case "assigned":
      return info.keys.length > 0;
    case "unassigned":
      return info.keys.length === 0;
    case "customised":
      return info.customised;
    case "conflicts":
      return info.conflicted;
    default:
      return true;
  }
};

/** Rows per filter chip, in one pass. */
export const filterCounts = (
  infos: readonly HotkeyInfo[],
): Record<FilterId, number> => {
  const counts: Record<FilterId, number> = {
    all: infos.length,
    assigned: 0,
    customised: 0,
    unassigned: 0,
    conflicts: 0,
  };
  for (const info of infos) {
    counts.assigned += info.keys.length > 0 ? 1 : 0;
    counts.unassigned += info.keys.length === 0 ? 1 : 0;
    counts.customised += info.customised ? 1 : 0;
    counts.conflicts += info.conflicted ? 1 : 0;
  }
  return counts;
};

/** One pass: text, a recorded chord and the filter chip. */
export const filterInfos = (
  infos: readonly HotkeyInfo[],
  {
    text,
    chord,
    filter,
  }: { text: string; chord: Chord | null; filter: FilterId },
): HotkeyInfo[] => {
  // Every word, in any order, folded like the vault search (as the Settings search does,
  // toimprove 223): "toggle mode" finds "Toggle light/dark mode".
  const words = foldKey(text.trim()).split(/\s+/).filter(Boolean);
  return infos.filter(
    (info) =>
      (!chord || info.keys.includes(chord)) &&
      (!words.length ||
        ((hay) => words.every((w) => hay.includes(w)))(
          foldKey(
            `${info.command.title}\n${info.command.id}\n${info.command.category}`,
          ),
        )) &&
      matchesFilter(info, filter),
  );
};

/** Consecutive rows of one category (the list is sorted by category). */
export const groupByCategory = (
  infos: readonly HotkeyInfo[],
): { category: string; infos: HotkeyInfo[] }[] => {
  const groups: { category: string; infos: HotkeyInfo[] }[] = [];
  for (const info of infos) {
    const last = groups[groups.length - 1];
    if (last && last.category === info.command.category) {
      last.infos.push(info);
    } else {
      groups.push({ category: info.command.category, infos: [info] });
    }
  }
  return groups;
};

/**
 * One sentence for a conflicting row: what it clashes with and which binding
 * wins. Among commands the first in registry order wins (the dispatcher takes
 * the first available match); a Vaultdraw command always beats Excalidraw's
 * own shortcut; a reserved chord never reaches the app.
 */
export const conflictSentence = (
  command: CommandDefinition,
  perChord: ReadonlyMap<Chord, readonly Conflict[]> | undefined,
  rank: ReadonlyMap<string, number>,
  platform: Platform,
): string | null => {
  if (!perChord || perChord.size === 0) {
    return null;
  }
  const [chord, found] = perChord.entries().next().value as [
    Chord,
    readonly Conflict[],
  ];
  const key = formatKeyLabel(chord, platform);
  const reserved = found.find((c) => c.kind === "reserved");
  if (reserved && reserved.kind === "reserved") {
    return reserved.blocked
      ? `${key} can't work: ${reserved.reason}. Change it.`
      : `${key}: ${reserved.reason}. Change it if that is not what you want.`;
  }
  const others = found.filter(
    (c): c is Extract<Conflict, { kind: "command" }> => c.kind === "command",
  );
  if (others.length > 0) {
    const first = others.reduce((a, b) =>
      (rank.get(a.id) ?? 0) <= (rank.get(b.id) ?? 0) ? a : b,
    );
    const thisWins = (rank.get(command.id) ?? 0) <= (rank.get(first.id) ?? 0);
    const names = others.map((c) => c.title).join(", ");
    return `Also bound to ${names}. ${
      thisWins ? "This one" : first.title
    } wins (first match). Change one of them.`;
  }
  const prefix = found.find(
    (c): c is Extract<Conflict, { kind: "prefix" }> => c.kind === "prefix",
  );
  if (prefix) {
    const other = formatKeyLabel(prefix.other, platform);
    return prefix.otherIsLonger
      ? `${key} is also the start of ${other} (${prefix.title}): the sequence wins. Change one of them.`
      : `${key} starts with ${other}, also bound to ${prefix.title}: the sequence wins. Change one of them.`;
  }
  const label = found
    .map((c) => (c.kind === "excalidraw" ? c.label : ""))
    .filter(Boolean)
    .join(", ");
  return `Also Excalidraw's ${label}. This one wins on the canvas. Change one of them.`;
};
