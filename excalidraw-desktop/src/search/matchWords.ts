/**
 * One rule for every type-to-filter list (toimprove 246): each word of the query must be found, in
 * any order, with case and accents folded, as in Obsidian's search and quick switcher, Zed's
 * pickers and Telescope.
 */
import { foldKey } from "./foldKey";

/** The folded words of a query; empty when there are none. */
export const queryWords = (query: string): string[] =>
  foldKey(query.trim()).split(/\s+/).filter(Boolean);

/** Whether every word is somewhere in the (already folded) text. */
export const hasAllWords = (
  words: readonly string[],
  folded: string,
): boolean => words.every((w) => folded.includes(w));

/** Whether every word of the query is in the fields. */
export const matchesWords = (query: string, ...fields: string[]): boolean =>
  hasAllWords(queryWords(query), foldKey(fields.join("\n")));
