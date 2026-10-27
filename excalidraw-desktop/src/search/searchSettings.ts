/**
 * Search settings: preference fields, config.toml keys (`[search]`), validation
 * and defaults. Pure data; settingsSync.ts / preferences.ts spread
 * `SEARCH_MAPPINGS` and `SEARCH_DEFAULTS` in. These are speed trade-offs:
 * defaults are the values the app always used.
 */
import type { ConfigMapping } from "../vault/settingsSync";

export const SEARCH_FIELDS = [
  "searchDebounceMs",
  "searchMaxDrawings",
  "searchMaxSnippets",
  "searchNotes",
  "searchNoteTextMb",
] as const;
export type SearchField = typeof SEARCH_FIELDS[number];

export const SEARCH_DEBOUNCE = { min: 0, max: 2000 } as const;
/** The search core clamps a request to 200 drawings. */
export const SEARCH_MAX_DRAWINGS = { min: 1, max: 200 } as const;
/** The index keeps at most 5 matching elements per drawing. */
export const SEARCH_MAX_SNIPPETS = { min: 1, max: 5 } as const;

/** Memory for note text in the index, in MB (the native side clamps at 4096). */
export const SEARCH_NOTE_TEXT_MB = { min: 0, max: 4096 } as const;

export interface SearchPreferences {
  /** Wait after the last keystroke before a search runs. */
  searchDebounceMs: number;
  /** Drawings listed in the search results. */
  searchMaxDrawings: number;
  /** Matching elements shown under each drawing. */
  searchMaxSnippets: number;
  /** Index the Markdown notes (`.md`) of the vault. Read when the index starts. */
  searchNotes: boolean;
  /** Megabytes of note text kept in memory; past it a note keeps its name, headings, tags and links. */
  searchNoteTextMb: number;
}

export const SEARCH_DEFAULTS: SearchPreferences = {
  searchDebounceMs: 60,
  searchMaxDrawings: 50,
  searchMaxSnippets: 5,
  searchNotes: true,
  searchNoteTextMb: 16,
};

const intIn =
  (r: { min: number; max: number }) =>
  (v: unknown): boolean =>
    typeof v === "number" && Number.isInteger(v) && v >= r.min && v <= r.max;

const VALID: Record<SearchField, (v: unknown) => boolean> = {
  searchDebounceMs: intIn(SEARCH_DEBOUNCE),
  searchMaxDrawings: intIn(SEARCH_MAX_DRAWINGS),
  searchMaxSnippets: intIn(SEARCH_MAX_SNIPPETS),
  searchNotes: (v) => typeof v === "boolean",
  searchNoteTextMb: intIn(SEARCH_NOTE_TEXT_MB),
};

export const SEARCH_MAPPINGS: readonly ConfigMapping[] = [
  {
    field: "searchDebounceMs",
    key: "search.debounce_ms",
    expected: `a whole number from ${SEARCH_DEBOUNCE.min} to ${SEARCH_DEBOUNCE.max} (milliseconds)`,
    valid: VALID.searchDebounceMs,
  },
  {
    field: "searchMaxDrawings",
    key: "search.max_drawings",
    expected: `a whole number from ${SEARCH_MAX_DRAWINGS.min} to ${SEARCH_MAX_DRAWINGS.max}`,
    valid: VALID.searchMaxDrawings,
  },
  {
    field: "searchMaxSnippets",
    key: "search.max_snippets",
    expected: `a whole number from ${SEARCH_MAX_SNIPPETS.min} to ${SEARCH_MAX_SNIPPETS.max}`,
    valid: VALID.searchMaxSnippets,
  },
  {
    field: "searchNotes",
    key: "search.notes",
    expected: "true or false",
    valid: VALID.searchNotes,
  },
  {
    field: "searchNoteTextMb",
    key: "search.note_text_mb",
    expected: `a whole number from ${SEARCH_NOTE_TEXT_MB.min} to ${SEARCH_NOTE_TEXT_MB.max}`,
    valid: VALID.searchNoteTextMb,
  },
];

/** Stored (localStorage) preferences -> valid search fields; bad ones default. */
export function normalizeSearchPreferences(
  input: Record<string, unknown>,
): SearchPreferences {
  return Object.fromEntries(
    SEARCH_FIELDS.map((field) => [
      field,
      VALID[field](input[field]) ? input[field] : SEARCH_DEFAULTS[field],
    ]),
  ) as unknown as SearchPreferences;
}
