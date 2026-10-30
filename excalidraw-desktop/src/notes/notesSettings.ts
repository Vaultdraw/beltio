/**
 * Notes settings: preference fields, config.toml keys (`[notes]`), validation
 * and defaults. Pure data; preferences.ts and settingsSync.ts spread
 * `NOTES_DEFAULTS`, `normalizeNotesPreferences` and `NOTES_MAPPINGS` in. The
 * notes extension itself is switched under `[extensions] notes`.
 */
import type { ConfigMapping } from "../vault/settingsSync";

export const NOTES_FIELDS = [
  "notesOpenIn",
  "notesVim",
  "notesLineWrap",
  "notesLineNumbers",
  "notesFontSize",
  "notesReadableWidth",
  "notesAutosaveMs",
  "notesHighlightCode",
  "notesMath",
  "notesRemoteImages",
  "notesToggleTasks",
] as const;
export type NotesField = typeof NOTES_FIELDS[number];

export const NOTES_OPEN_IN = ["reading", "editing"] as const;
export const NOTES_FONT_SIZE = { min: 10, max: 32 } as const;
export const NOTES_READABLE_WIDTH = { min: 0, max: 2000 } as const;
export const NOTES_AUTOSAVE_MS = { min: 0, max: 60000 } as const;

export interface NotesPreferences {
  /** What a note shows when it opens. */
  notesOpenIn: typeof NOTES_OPEN_IN[number];
  /** Vim keys in the note editor. */
  notesVim: boolean;
  notesLineWrap: boolean;
  notesLineNumbers: boolean;
  /** px */
  notesFontSize: number;
  /** Widest the reading text gets, px; 0 = the whole pane. */
  notesReadableWidth: number;
  /** Save this long after the last keystroke; 0 = only on the save command. */
  notesAutosaveMs: number;
  /** Colour code blocks in the reading view. */
  notesHighlightCode: boolean;
  /** Render `$…$` and `$$…$$` as formulas. */
  notesMath: boolean;
  /** Load images from http(s) addresses. Off keeps the note fully offline. */
  notesRemoteImages: boolean;
  /** Tick task checkboxes in the reading view (written through the guarded save). */
  notesToggleTasks: boolean;
}

export const NOTES_DEFAULTS: NotesPreferences = {
  notesOpenIn: "reading",
  notesVim: false,
  notesLineWrap: true,
  notesLineNumbers: false,
  notesFontSize: 16,
  notesReadableWidth: 760,
  notesAutosaveMs: 800,
  notesHighlightCode: true,
  notesMath: true,
  notesRemoteImages: true,
  notesToggleTasks: true,
};

const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const ints =
  (r: { min: number; max: number }) =>
  (v: unknown): boolean =>
    typeof v === "number" && Number.isInteger(v) && v >= r.min && v <= r.max;
const isOpenIn = (v: unknown): boolean =>
  typeof v === "string" && (NOTES_OPEN_IN as readonly string[]).includes(v);

const VALID: Record<NotesField, (v: unknown) => boolean> = {
  notesOpenIn: isOpenIn,
  notesVim: isBool,
  notesLineWrap: isBool,
  notesLineNumbers: isBool,
  notesFontSize: ints(NOTES_FONT_SIZE),
  notesReadableWidth: ints(NOTES_READABLE_WIDTH),
  notesAutosaveMs: ints(NOTES_AUTOSAVE_MS),
  notesHighlightCode: isBool,
  notesMath: isBool,
  notesRemoteImages: isBool,
  notesToggleTasks: isBool,
};

const bool = (field: NotesField, key: string): ConfigMapping => ({
  field,
  key,
  expected: "true or false",
  valid: isBool,
});

const range = (
  field: NotesField,
  key: string,
  r: { min: number; max: number },
  what: string,
): ConfigMapping => ({
  field,
  key,
  expected: `a whole number from ${r.min} to ${r.max} (${what})`,
  valid: ints(r),
});

export const NOTES_MAPPINGS: readonly ConfigMapping[] = [
  {
    field: "notesOpenIn",
    key: "notes.open_in",
    expected: '"reading" or "editing"',
    valid: isOpenIn,
  },
  bool("notesVim", "notes.vim"),
  bool("notesLineWrap", "notes.line_wrap"),
  bool("notesLineNumbers", "notes.line_numbers"),
  range("notesFontSize", "notes.font_size", NOTES_FONT_SIZE, "pixels"),
  range(
    "notesReadableWidth",
    "notes.readable_width",
    NOTES_READABLE_WIDTH,
    "pixels, 0 = the whole pane",
  ),
  range(
    "notesAutosaveMs",
    "notes.autosave_ms",
    NOTES_AUTOSAVE_MS,
    "milliseconds, 0 = save only with the save command",
  ),
  bool("notesHighlightCode", "notes.highlight_code"),
  bool("notesMath", "notes.math"),
  bool("notesRemoteImages", "notes.remote_images"),
  bool("notesToggleTasks", "notes.toggle_tasks"),
];

/** Stored (localStorage) preferences -> valid notes fields; bad ones default. */
export function normalizeNotesPreferences(
  input: Record<string, unknown>,
): NotesPreferences {
  return Object.fromEntries(
    NOTES_FIELDS.map((field) => [
      field,
      VALID[field](input[field]) ? input[field] : NOTES_DEFAULTS[field],
    ]),
  ) as unknown as NotesPreferences;
}
