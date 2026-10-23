/**
 * Key options: preference fields, config.toml keys (`[keys]`, `[keys.labels]`),
 * validation and defaults. Pure data; settingsSync.ts / preferences.ts spread
 * `KEYS_MAPPINGS` and `KEYS_DEFAULTS` in. `[keys]` holds options only: the
 * key-to-command table is `[hotkeys]`.
 */
import {
  DEFAULT_KEY_OPTIONS,
  LEADER_TOKEN,
  parseSequence,
} from "./keySequence";

import type { ConfigMapping, SettingsProblem } from "../vault/settingsSync";
import type { KeyOptions } from "./keySequence";

export const KEYS_FIELDS = [
  "keysLeader",
  "keysTimeoutMs",
  "keysCancelAfterMs",
  "keysWhichKey",
  "keysWhichKeyDelayMs",
  "keysWhichKeyPosition",
] as const;
export type KeysField = typeof KEYS_FIELDS[number];

export const KEYS_WHICH_KEY_POSITIONS = ["bottom", "center"] as const;
export type WhichKeyPosition = typeof KEYS_WHICH_KEY_POSITIONS[number];

/** Upper bound of the delays: keeps setTimeout far below its 2^31 ms limit. */
export const KEYS_MAX_MS = 3_600_000;

export interface KeysPreferences {
  /** keys.leader: chord text `<leader>` expands to. */
  keysLeader: string;
  /** keys.timeout_ms: 0 = wait for a key. */
  keysTimeoutMs: number;
  /** keys.cancel_after_ms: 0 = never. */
  keysCancelAfterMs: number;
  /** keys.which_key */
  keysWhichKey: boolean;
  /** keys.which_key_delay_ms */
  keysWhichKeyDelayMs: number;
  /** keys.which_key_position */
  keysWhichKeyPosition: WhichKeyPosition;
  /** `[keys.labels]`: sequence as written in the file -> group label. */
  keysLabels: Record<string, string>;
}

export const KEYS_DEFAULTS: KeysPreferences = {
  keysLeader: DEFAULT_KEY_OPTIONS.leader,
  keysTimeoutMs: DEFAULT_KEY_OPTIONS.timeoutMs,
  keysCancelAfterMs: DEFAULT_KEY_OPTIONS.cancelAfterMs,
  keysWhichKey: true,
  keysWhichKeyDelayMs: 400,
  keysWhichKeyPosition: "bottom",
  keysLabels: {},
};

/** What the which-key popup needs beyond the resolver's `KeyOptions`. */
export interface WhichKeyOptions {
  whichKey: boolean;
  whichKeyDelayMs: number;
  whichKeyPosition: WhichKeyPosition;
  /** Canonical sequence -> label. */
  labels: Readonly<Record<string, string>>;
}

export type KeySettings = KeyOptions & WhichKeyOptions;

export const DEFAULT_KEY_SETTINGS: KeySettings = {
  ...DEFAULT_KEY_OPTIONS,
  whichKey: KEYS_DEFAULTS.keysWhichKey,
  whichKeyDelayMs: KEYS_DEFAULTS.keysWhichKeyDelayMs,
  whichKeyPosition: KEYS_DEFAULTS.keysWhichKeyPosition,
  labels: KEYS_DEFAULTS.keysLabels,
};

/** Stored fields -> the settings object the resolver and which-key read. */
export const toKeySettings = (prefs: KeysPreferences): KeySettings => ({
  leader: prefs.keysLeader,
  timeoutMs: prefs.keysTimeoutMs,
  cancelAfterMs: prefs.keysCancelAfterMs,
  whichKey: prefs.keysWhichKey,
  whichKeyDelayMs: prefs.keysWhichKeyDelayMs,
  whichKeyPosition: prefs.keysWhichKeyPosition,
  labels: prefs.keysLabels,
});

const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isMs = (v: unknown): boolean =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= KEYS_MAX_MS;
const isPosition = (v: unknown): boolean =>
  typeof v === "string" &&
  (KEYS_WHICH_KEY_POSITIONS as readonly string[]).includes(v);
/** One chord, parsed by the production parser (Vim aliases like <Space> too). */
const isLeader = (v: unknown): boolean => {
  if (typeof v !== "string") {
    return false;
  }
  const chords = parseSequence(v, null, LEADER_TOKEN);
  return !!chords && chords.length === 1 && chords[0] !== LEADER_TOKEN;
};

const ms = (field: KeysField, key: string, what: string): ConfigMapping => ({
  field,
  key,
  expected: `a whole number from 0 to ${KEYS_MAX_MS} (${what})`,
  valid: isMs,
});

export const KEYS_MAPPINGS: readonly ConfigMapping[] = [
  {
    field: "keysLeader",
    key: "keys.leader",
    expected: 'one key like "Backslash", "Space" or "Alt+K"',
    valid: isLeader,
  },
  ms("keysTimeoutMs", "keys.timeout_ms", "0 = wait for a key"),
  ms("keysCancelAfterMs", "keys.cancel_after_ms", "0 = never"),
  {
    field: "keysWhichKey",
    key: "keys.which_key",
    expected: "true or false",
    valid: isBool,
  },
  ms("keysWhichKeyDelayMs", "keys.which_key_delay_ms", "milliseconds"),
  {
    field: "keysWhichKeyPosition",
    key: "keys.which_key_position",
    expected: KEYS_WHICH_KEY_POSITIONS.map((p) => `"${p}"`).join(" or "),
    valid: isPosition,
  },
];

const VALID: Record<KeysField, (v: unknown) => boolean> = {
  keysLeader: isLeader,
  keysTimeoutMs: isMs,
  keysCancelAfterMs: isMs,
  keysWhichKey: isBool,
  keysWhichKeyDelayMs: isMs,
  keysWhichKeyPosition: isPosition,
};

/** The label table: only string -> string entries survive. */
export const normalizeKeysLabels = (value: unknown): Record<string, string> => {
  const labels: Record<string, string> = {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [seq, label] of Object.entries(value)) {
      if (typeof label === "string") {
        labels[seq] = label;
      }
    }
  }
  return labels;
};

/** Stored (localStorage) preferences -> valid keys fields; bad ones default. */
export function normalizeKeysPreferences(
  input: Record<string, unknown>,
): KeysPreferences {
  const fields = Object.fromEntries(
    KEYS_FIELDS.map((field) => [
      field,
      VALID[field](input[field]) ? input[field] : KEYS_DEFAULTS[field],
    ]),
  );
  return {
    ...fields,
    keysLabels: normalizeKeysLabels(input.keysLabels),
  } as unknown as KeysPreferences;
}

const problem = (key: string, message: string): SettingsProblem => ({
  kind: "invalid",
  key,
  message,
});

const KNOWN_KEYS = new Set([
  ...KEYS_MAPPINGS.map((m) => m.key.slice("keys.".length)),
  "labels",
]);

/**
 * The `[keys.labels]` table and the unknown-key check of `[keys]` (the scalar
 * keys are CONFIG_MAPPING rows). Labels are keyed by the canonical sequence
 * (`<leader>` literal), so "<leader> F" and "<leader> f" differ only as the
 * chord parser says. Keys stay as written so Settings can edit the exact line;
 * `resolveLabels` canonicalises when it looks one up. A bad entry is left out with a problem naming its path.
 */
export function parseKeysExtras(table: unknown): {
  labels: Record<string, string>;
  problems: SettingsProblem[];
} {
  const labels: Record<string, string> = {};
  const problems: SettingsProblem[] = [];
  if (table === undefined) {
    return { labels, problems };
  }
  if (!table || typeof table !== "object" || Array.isArray(table)) {
    // The scalar rows already report a non-table [keys] as missing values.
    problems.push(
      problem(
        "keys",
        "config.toml: keys: expected a table; using the defaults",
      ),
    );
    return { labels, problems };
  }
  const record = table as Record<string, unknown>;
  for (const name of Object.keys(record)) {
    if (!KNOWN_KEYS.has(name)) {
      problems.push(
        problem(
          `keys.${name}`,
          `config.toml: keys.${name} is not a known key; ignored`,
        ),
      );
    }
  }
  const raw = record.labels;
  if (raw === undefined) {
    return { labels, problems };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    problems.push(
      problem(
        "keys.labels",
        'config.toml: keys.labels: expected a table of sequence = "label"; ignored',
      ),
    );
    return { labels, problems };
  }
  for (const [seq, label] of Object.entries(raw)) {
    const key = `keys.labels.${seq}`;
    const chords = parseSequence(seq, null, LEADER_TOKEN);
    if (!chords) {
      problems.push(
        problem(
          key,
          `config.toml: ${key}: "${seq}" is not a valid key sequence; ignored`,
        ),
      );
    } else if (typeof label !== "string" || label.trim() === "") {
      problems.push(
        problem(
          key,
          `config.toml: ${key} is not valid (expected a label like "file"); ignored`,
        ),
      );
    } else {
      // Keyed as written, so Settings can rewrite or remove the exact line;
      // `resolveLabels` parses each key again.
      labels[seq] = label;
    }
  }
  return { labels, problems };
}

/** True when two spellings are the same sequence (`g g` and `G G`). */
export const sameKeySequence = (a: string, b: string): boolean => {
  const x = parseSequence(a, null, LEADER_TOKEN);
  const y = parseSequence(b, null, LEADER_TOKEN);
  return !!x && !!y && x.join(" ") === y.join(" ");
};

/** Longest label text Settings writes (the writer allows 1024). */
export const KEY_LABEL_MAX = 80;

/**
 * Checks a new label's sequence and text for the Settings editor. Returns the
 * trimmed pair, or the reason it was refused.
 */
export function checkKeyLabel(
  sequence: string,
  text: string,
): { sequence: string; text: string } | { error: string } {
  const seq = sequence.trim().replace(/\s+/g, " ");
  const label = text.trim();
  if (!seq || !parseSequence(seq, null, LEADER_TOKEN)) {
    return { error: 'Not a key sequence. Try "<leader> f" or "g g".' };
  }
  if (!label) {
    return { error: "Give the group a name." };
  }
  if (label.length > KEY_LABEL_MAX) {
    return { error: `Keep the name under ${KEY_LABEL_MAX} characters.` };
  }
  return { sequence: seq, text: label };
}
