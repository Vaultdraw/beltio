/**
 * Layout settings: which parts of the window show (`[layout]`), and named
 * presets (`[layout.presets.<name>]`) that change several parts at once;
 * focus mode is the built-in `focus` preset. Pure data; settingsSync.ts /
 * preferences.ts spread `LAYOUT_MAPPINGS`, `LAYOUT_FIELDS` and
 * `LAYOUT_DEFAULTS` in.
 *
 * Only `header` and `footer` have their base switch here: the activity bar
 * (`interface.activity_bar`), the tab strip (`tabs.show_strip`) and the
 * navigator (its collapse state) keep the switches they already had.
 */
import type { ConfigMapping } from "../vault/settingsSync";

export const LAYOUT_PARTS = [
  "header",
  "navigator",
  "activity_bar",
  "tab_strip",
  "footer",
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
}

export const LAYOUT_DEFAULTS: LayoutPreferences = {
  layoutHeader: true,
  layoutFooter: true,
  layoutPreset: "",
  layoutPresets: {},
};

export const FOCUS_PRESET = "focus";

/** Built-in presets; a user preset with the same name replaces one. */
export const BUILTIN_PRESETS: LayoutPresets = {
  [FOCUS_PRESET]: {
    header: false,
    navigator: false,
    activity_bar: false,
    tab_strip: false,
    footer: false,
  },
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

/** Why `value` is not a valid `[layout.presets]` table, or null. */
export function presetsProblem(value: unknown): string | null {
  if (!isTable(value)) {
    return "a table of presets like [layout.presets.reading]";
  }
  const names = Object.keys(value);
  if (names.length > MAX_PRESETS) {
    return `at most ${MAX_PRESETS} presets`;
  }
  for (const name of names) {
    if (!isPresetName(name)) {
      return `preset names use letters, digits, - and _ ("${name}")`;
    }
    const preset = value[name];
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
  }
  return null;
}

export const isPresets = (v: unknown): v is LayoutPresets =>
  presetsProblem(v) === null;

const isBool = (v: unknown): v is boolean => typeof v === "boolean";
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
    valid: isPresets,
  },
];

const VALID: Record<LayoutField, (v: unknown) => boolean> = {
  layoutHeader: isBool,
  layoutFooter: isBool,
  layoutPreset: isPresetChoice,
  layoutPresets: isPresets,
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
export const allPresets = (user: LayoutPresets): LayoutPresets =>
  Object.keys(user).length === 0
    ? BUILTIN_PRESETS
    : { ...BUILTIN_PRESETS, ...user };

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
