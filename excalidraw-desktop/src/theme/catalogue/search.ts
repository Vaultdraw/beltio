/** Search and filters for the theme browser: in memory, instant for thousands of entries. */

import type { CatalogueEntry, ThemeMode } from "./types";

export interface Filters {
  query: string;
  /** Empty = any tag. */
  tag: string;
  mode: "all" | ThemeMode;
}

export const NO_FILTERS: Filters = { query: "", tag: "", mode: "all" };

/** Score of one token against one entry; 0 = no match. */
const tokenScore = (token: string, e: CatalogueEntry): number => {
  const name = e.name.toLowerCase();
  if (name.startsWith(token)) {
    return 100;
  }
  if (name.includes(token)) {
    return 60;
  }
  if (e.tags.some((t) => t.toLowerCase().includes(token))) {
    return 30;
  }
  if (e.author.toLowerCase().includes(token)) {
    return 20;
  }
  if (e.description.toLowerCase().includes(token)) {
    return 10;
  }
  return 0;
};

/** Entries that pass the filters. With a query: every word must match, best matches first. */
export const filterEntries = (
  entries: readonly CatalogueEntry[],
  filters: Filters,
): CatalogueEntry[] => {
  const tokens = filters.query.toLowerCase().split(/\s+/).filter(Boolean);
  const tag = filters.tag.toLowerCase();
  const scored: { entry: CatalogueEntry; score: number; at: number }[] = [];
  entries.forEach((entry, at) => {
    if (filters.mode !== "all" && !entry.modes.includes(filters.mode)) {
      return;
    }
    if (tag && !entry.tags.some((t) => t.toLowerCase() === tag)) {
      return;
    }
    let score = 0;
    for (const token of tokens) {
      const s = tokenScore(token, entry);
      if (s === 0) {
        return;
      }
      score += s;
    }
    scored.push({ entry, score, at });
  });
  if (tokens.length > 0) {
    scored.sort((a, b) => b.score - a.score || a.at - b.at);
  }
  return scored.map((s) => s.entry);
};

/** Every tag with how many entries carry it, most used first (the `dark` and `light` tags are the mode filter). */
export const tagCounts = (
  entries: readonly CatalogueEntry[],
): { tag: string; count: number }[] => {
  const counts = new Map<string, number>();
  for (const e of entries) {
    for (const t of e.tags) {
      const key = t.toLowerCase();
      if (key !== "dark" && key !== "light") {
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
};
