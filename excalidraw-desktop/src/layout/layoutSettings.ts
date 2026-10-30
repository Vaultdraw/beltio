/**
 * Layout settings: which parts of the window show (`[layout]`), and named
 * presets (`[layout.presets.<name>]`) that change several parts at once;
 * focus mode is the built-in `focus` preset, shaped by `[focus] hide`. Pure data; settingsSync.ts /
 * preferences.ts spread `LAYOUT_MAPPINGS`, `LAYOUT_FIELDS` and
 * `LAYOUT_DEFAULTS` in.
 *
 * Only `header` and `footer` have their base switch here: the activity bar
 * (`interface.activity_bar`), the tab strip (`tabs.show_strip`) and the
 * navigator (its collapse state) keep the switches they already had.
 */
import type { ConfigMapping, SettingsProblem } from "../vault/settingsSync";

export const LAYOUT_PARTS = [
  "header",
  "navigator",
  "activity_bar",
  "tab_strip",
  "footer",
  "status_bar",
] as const;
export type LayoutPart = typeof LAYOUT_PARTS[number];

/** A preset lists only the parts it changes. */
export type LayoutPreset = Readonly<Partial<Record<LayoutPart, boolean>>>;
export type LayoutPresets = Readonly<Record<string, LayoutPreset>>;

export const LAYOUT_FIELDS = [
  "layoutHeader",
  "layoutFooter",
  "layoutPreset",
  "layoutPresets",
  "focusHide",
  "focusRemember",
  "focusHint",
  "focusOn",
  "layoutNarrowWidth",
] as const;
export type LayoutField = typeof LAYOUT_FIELDS[number];

export interface LayoutPreferences {
  /** The vault header (title, save status, History and Graph buttons). */
  layoutHeader: boolean;
  /** Excalidraw's footer (zoom, undo and redo, help). */
  layoutFooter: boolean;
  /** Preset applied at launch and whenever this value changes; "" = none. */
  layoutPreset: string;
  /** The user's presets; the built-in ones are added by `allPresets`. */
  layoutPresets: LayoutPresets;
  /** `[focus] hide`: the parts focus mode hides. */
  focusHide: readonly LayoutPart[];
  /** `[focus] remember`: reopen in focus mode if it was on at quit. */
  focusRemember: boolean;
  /** `[focus] hint`: a small "Focus" chip while focus mode is on. */
  focusHint: boolean;
  /** Focus mode was on at quit (kept only while `focusRemember`; not in config). */
  focusOn: boolean;
  /**
   * `[layout] narrow_width`: below this window width (px) the file list starts folded, for
   * narrow or tiled windows, and shows as an overlay when asked for; 0 = never (hunter A-7, toimprove 138).
   */
  layoutNarrowWidth: number;
}

export const LAYOUT_DEFAULTS: LayoutPreferences = {
  layoutHeader: true,
  layoutFooter: true,
  layoutPreset: "",
  layoutPresets: {},
  focusHide: LAYOUT_PARTS,
  focusRemember: false,
  focusHint: false,
  focusOn: false,
  layoutNarrowWidth: 600,
};

export const FOCUS_PRESET = "focus";

/** The focus preset: every part in `hide` goes away. */
export const focusPreset = (hide: readonly LayoutPart[]): LayoutPreset =>
  Object.fromEntries(hide.map((part) => [part, false]));

/** Built-in presets (focus hides every part); a user preset with the same name replaces one. */
export const BUILTIN_PRESETS: LayoutPresets = {
  [FOCUS_PRESET]: focusPreset(LAYOUT_PARTS),
};

/** Preset names are TOML bare keys, so they make clean command ids. */
const NAME = /^[A-Za-z0-9_-]{1,40}$/;
export const MAX_PRESETS = 50;

export const isPresetName = (v: unknown): v is string =>
  typeof v === "string" && NAME.test(v);

const isTable = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

const isPart = (key: string): key is LayoutPart =>
  (LAYOUT_PARTS as readonly string[]).includes(key);

/** Why one preset entry is not valid, or null. */
function entryProblem(name: string, preset: unknown): string | null {
  if (!isPresetName(name)) {
    return `preset names use letters, digits, - and _ ("${name}")`;
  }
  if (!isTable(preset)) {
    return `[layout.presets.${name}] must be a table`;
  }
  for (const [part, shown] of Object.entries(preset)) {
    if (!isPart(part)) {
      return `layout.presets.${name}.${part} is not a part (${LAYOUT_PARTS.join(
        ", ",
      )})`;
    }
    if (typeof shown !== "boolean") {
      return `layout.presets.${name}.${part} must be true or false`;
    }
  }
  return null;
}

/** Why the whole `[layout.presets]` value is unusable, or null. */
export function presetsProblem(value: unknown): string | null {
  if (!isTable(value)) {
    return "a table of presets like [layout.presets.reading]";
  }
  return Object.keys(value).length > MAX_PRESETS
    ? `at most ${MAX_PRESETS} presets`
    : null;
}

/**
 * The valid entries of a `[layout.presets]` table, and one message per bad
 * entry: a typo in one preset never drops the others.
 */
export function splitPresets(value: unknown): {
  presets: LayoutPresets;
  problems: string[];
} {
  if (presetsProblem(value) !== null) {
    return { presets: {}, problems: [] };
  }
  const presets: Record<string, LayoutPreset> = {};
  const problems: string[] = [];
  for (const [name, preset] of Object.entries(value as object)) {
    const why = entryProblem(name, preset);
    if (why) {
      problems.push(why);
    } else {
      presets[name] = preset as LayoutPreset;
    }
  }
  return { presets, problems };
}

export const isPresets = (v: unknown): v is LayoutPresets =>
  presetsProblem(v) === null &&
  Object.entries(v as object).every(([n, p]) => entryProblem(n, p) === null);

/** Per-entry problems of `[layout.presets]` in a parsed config (the mapping keeps the rest). */
export function layoutPresetProblems(
  config: Record<string, unknown>,
  file = "config.toml",
): SettingsProblem[] {
  const layout = config.layout;
  if (!isTable(layout)) {
    return [];
  }
  return splitPresets(layout.presets).problems.map((message) => ({
    kind: "invalid",
    key: "layout.presets",
    message: `${file}: ${message}; that preset is ignored`,
  }));
}

const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isNarrowWidth = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 4000;
const isPartList = (v: unknown): v is LayoutPart[] =>
  Array.isArray(v) &&
  v.length <= LAYOUT_PARTS.length &&
  v.every((p) => typeof p === "string" && isPart(p));
// Any text: a name that matches no preset is reported when it is applied.
const isPresetChoice = (v: unknown): boolean => typeof v === "string";

export const LAYOUT_MAPPINGS: readonly ConfigMapping[] = [
  {
    field: "layoutHeader",
    key: "layout.header",
    expected: "true or false",
    valid: isBool,
  },
  {
    field: "layoutFooter",
    key: "layout.footer",
    expected: "true or false",
    valid: isBool,
  },
  {
    field: "layoutPreset",
    key: "layout.preset",
    expected: 'a preset name like "focus", or "" for none (text)',
    valid: isPresetChoice,
  },
  {
    field: "layoutPresets",
    key: "layout.presets",
    expected: (value: unknown) => presetsProblem(value) ?? "valid presets",
    // Bad entries are dropped here and reported by layoutPresetProblems.
    normalize: (value: unknown) =>
      presetsProblem(value) === null ? splitPresets(value).presets : value,
    valid: isPresets,
  },
  {
    field: "layoutNarrowWidth",
    key: "layout.narrow_width",
    expected: "a whole number from 0 to 4000 (pixels, 0 = never)",
    valid: (v: unknown) => isNarrowWidth(v),
  },
  {
    field: "focusHide",
    key: "focus.hide",
    expected: `a list of parts: ${LAYOUT_PARTS.join(", ")}`,
    valid: isPartList,
  },
  {
    field: "focusRemember",
    key: "focus.remember",
    expected: "true or false",
    valid: isBool,
  },
  {
    field: "focusHint",
    key: "focus.hint",
    expected: "true or false",
    valid: isBool,
  },
];

const VALID: Record<LayoutField, (v: unknown) => boolean> = {
  layoutHeader: isBool,
  layoutFooter: isBool,
  layoutPreset: isPresetChoice,
  layoutPresets: isPresets,
  focusHide: isPartList,
  focusRemember: isBool,
  focusHint: isBool,
  focusOn: isBool,
  layoutNarrowWidth: isNarrowWidth,
};

/** Stored (localStorage) preferences -> valid layout fields; bad ones default. */
export function normalizeLayoutPreferences(
  input: Record<string, unknown>,
): LayoutPreferences {
  return Object.fromEntries(
    LAYOUT_FIELDS.map((field) => [
      field,
      VALID[field](input[field]) ? input[field] : LAYOUT_DEFAULTS[field],
    ]),
  ) as unknown as LayoutPreferences;
}

/** Built-in presets, then the user's (same name replaces). */
export const allPresets = (
  user: LayoutPresets,
  focusHide: readonly LayoutPart[] = LAYOUT_PARTS,
): LayoutPresets => {
  const builtin =
    focusHide === LAYOUT_PARTS
      ? BUILTIN_PRESETS
      : { [FOCUS_PRESET]: focusPreset(focusHide) };
  return Object.keys(user).length === 0 ? builtin : { ...builtin, ...user };
};

export type ShownParts = Readonly<Record<LayoutPart, boolean>>;

/**
 * What shows: a session toggle wins, then the active preset if it lists the
 * part, then the part's base switch.
 */
export function shownParts(
  base: ShownParts,
  preset: LayoutPreset | null,
  session: LayoutPreset,
): ShownParts {
  const out = {} as Record<LayoutPart, boolean>;
  for (const part of LAYOUT_PARTS) {
    out[part] = session[part] ?? preset?.[part] ?? base[part];
  }
  return out;
}
