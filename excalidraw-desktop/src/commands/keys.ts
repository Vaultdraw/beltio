/**
 * Chord notation, parsing, formatting and event matching.
 *
 * Canonical chord = modifiers in the order Mod, Ctrl, Alt, Shift, Meta, then
 * one key name, joined by "+": "Mod+Shift+Equal", "Mod+Comma", "F2", "Alt+N".
 * Key names are `KeyboardEvent.code` with the "Key" prefix stripped from
 * letters (KeyN -> "N") and "Digit" from digits (Digit0 -> "0"); every other
 * key keeps its code ("Comma", "BracketLeft", "ArrowUp", "Numpad0", "F5").
 * Keys are layout-independent (physical positions), like Obsidian and Zed.
 *
 * `Mod` is Cmd on macOS and Ctrl elsewhere. `normalizeChord` folds the
 * platform's real primary modifier (Meta on mac, Ctrl on win/linux) into Mod
 * so "Cmd+S" in a config file and "Mod+S" compare equal; `chordFromEvent`
 * already returns normalised chords, so keymap lookup is one Map.get.
 */
import type { Chord, Platform } from "./types";

type Modifier = "Mod" | "Ctrl" | "Alt" | "Shift" | "Meta";
const MODIFIER_ORDER: readonly Modifier[] = [
  "Mod",
  "Ctrl",
  "Alt",
  "Shift",
  "Meta",
];

const MODIFIER_ALIASES: Record<string, Modifier> = {
  mod: "Mod",
  cmdorctrl: "Mod",
  ctrlorcmd: "Mod",
  commandorcontrol: "Mod",
  controlorcommand: "Mod",
  ctrl: "Ctrl",
  control: "Ctrl",
  "⌃": "Ctrl",
  alt: "Alt",
  option: "Alt",
  opt: "Alt",
  "⌥": "Alt",
  shift: "Shift",
  "⇧": "Shift",
  meta: "Meta",
  cmd: "Meta",
  command: "Meta",
  super: "Meta",
  win: "Meta",
  "⌘": "Meta",
};

const NAMED_KEYS = [
  "Comma",
  "Period",
  "Slash",
  "Backslash",
  "BracketLeft",
  "BracketRight",
  "Quote",
  "Semicolon",
  "Minus",
  "Equal",
  "Backquote",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Enter",
  "Escape",
  "Tab",
  "Space",
  "Backspace",
  "Delete",
  "Insert",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "ContextMenu",
  "NumpadAdd",
  "NumpadSubtract",
  "NumpadMultiply",
  "NumpadDivide",
  "NumpadDecimal",
  "NumpadEnter",
  "NumpadEqual",
] as const;

/** lower-case alias -> canonical key name. */
const KEY_ALIASES = new Map<string, string>();
const alias = (name: string, canonical = name) =>
  KEY_ALIASES.set(name.toLowerCase(), canonical);

for (const name of NAMED_KEYS) {
  alias(name);
}
for (let i = 0; i <= 9; i++) {
  alias(String(i));
  alias(`Digit${i}`, String(i));
  alias(`Numpad${i}`);
}
for (let c = 65; c <= 90; c++) {
  const letter = String.fromCharCode(c);
  alias(letter);
  alias(`Key${letter}`, letter);
}
for (let i = 1; i <= 24; i++) {
  alias(`F${i}`);
}
const LITERALS: Record<string, string> = {
  ",": "Comma",
  ".": "Period",
  "/": "Slash",
  "\\": "Backslash",
  "[": "BracketLeft",
  "]": "BracketRight",
  "'": "Quote",
  ";": "Semicolon",
  "-": "Minus",
  "=": "Equal",
  "`": "Backquote",
  "+": "Equal",
  plus: "Equal",
  " ": "Space",
  esc: "Escape",
  return: "Enter",
  del: "Delete",
  ins: "Insert",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  pgup: "PageUp",
  pgdn: "PageDown",
  spacebar: "Space",
  numpadplus: "NumpadAdd",
  numpadminus: "NumpadSubtract",
};
for (const [from, to] of Object.entries(LITERALS)) {
  KEY_ALIASES.set(from, to);
}

/** Canonical key name for an alias, `KeyboardEvent.code` or `key`; else null. */
const canonicalKey = (text: string): string | null =>
  KEY_ALIASES.get(text.toLowerCase()) ?? null;

export function detectPlatform(win?: Window | null): Platform {
  const nav =
    win?.navigator ??
    (typeof navigator !== "undefined" ? navigator : undefined);
  const text = `${nav?.platform ?? ""} ${nav?.userAgent ?? ""}`;
  if (/mac|darwin/i.test(text)) {
    return "mac";
  }
  if (/win/i.test(text)) {
    return "win";
  }
  return "linux";
}

interface Parts {
  mods: ReadonlySet<Modifier>;
  key: string;
}

const join = (mods: ReadonlySet<Modifier>, key: string): Chord =>
  [...MODIFIER_ORDER.filter((m) => mods.has(m)), key].join("+");

/** Split "Cmd+Shift+=" tolerantly; null when it is not exactly mods + 1 key. */
function parseParts(text: string): Parts | null {
  let source = text.trim();
  if (!source) {
    return null;
  }
  // A literal "+" key: "Mod++", "Mod+Shift++" or just "+".
  if (source === "+") {
    source = "Plus";
  } else if (source.endsWith("++")) {
    source = `${source.slice(0, -1)}Plus`;
  }
  const mods = new Set<Modifier>();
  let key: string | null = null;
  for (const raw of source.split("+")) {
    const token = raw.trim();
    if (!token) {
      return null;
    }
    const modifier = MODIFIER_ALIASES[token.toLowerCase()];
    if (modifier) {
      mods.add(modifier);
      continue;
    }
    const canonical = canonicalKey(token);
    if (!canonical || key !== null) {
      return null;
    }
    key = canonical;
  }
  return key === null ? null : { mods, key };
}

/**
 * Parse user text into a canonical chord; null for modifier-only, unknown or
 * duplicate keys. Does NOT fold the platform modifier (see normalizeChord).
 */
export function parseChord(text: string): Chord | null {
  const parts = parseParts(text);
  return parts ? join(parts.mods, parts.key) : null;
}

/**
 * Fold the platform's primary modifier into Mod: Meta on mac, Ctrl on
 * win/linux. Unparsable input is returned unchanged.
 */
export function normalizeChord(chord: Chord, platform: Platform): Chord {
  const parts = parseParts(chord);
  if (!parts) {
    return chord;
  }
  const primary: Modifier = platform === "mac" ? "Meta" : "Ctrl";
  if (!parts.mods.has(primary)) {
    return join(parts.mods, parts.key);
  }
  const mods = new Set(parts.mods);
  mods.delete(primary);
  mods.add("Mod");
  return join(mods, parts.key);
}

const MODIFIER_KEYS = new Set([
  "shift",
  "control",
  "alt",
  "meta",
  "altgraph",
  "os",
  "capslock",
  "fn",
]);
const LATIN = /^[a-z]$/i;
const isModifierCode = (code: string) =>
  /^(Shift|Control|Alt|Meta|OS)(Left|Right)$/.test(code);

export type KeyEventLike = Pick<
  KeyboardEvent,
  "code" | "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"
>;

/**
 * Normalised chord for a keydown, or null for modifier-only presses and keys
 * we have no name for. Letters without Mod/Ctrl/Alt are matched by the typed
 * character (layout-correct); everything else by the physical key (`code`),
 * and non-Latin layouts fall back to `code` as well. Synthetic events (smoke/perf scripts) have an empty
 * `code`: the key is derived from `e.key`, and when both meta and ctrl are set
 * there it counts as plain Mod (the scripts set both to work on every OS).
 */
export function chordFromEventUncached(
  e: KeyEventLike,
  platform: Platform,
): Chord | null {
  let key: string | null;
  if (e.code && !e.metaKey && !e.ctrlKey && !e.altKey && LATIN.test(e.key)) {
    // Plain (or Shift+) letters follow the layout, like Vim and Excalidraw's
    // tool keys: `j` is the key that types j on Dvorak/AZERTY too. With Mod,
    // Ctrl or Alt the physical key counts (Option+N types a dead key).
    key = e.key.toUpperCase();
  } else if (e.code) {
    if (isModifierCode(e.code)) {
      return null;
    }
    key = canonicalKey(e.code);
  } else {
    if (!e.key || MODIFIER_KEYS.has(e.key.toLowerCase())) {
      return null;
    }
    key = canonicalKey(e.key);
  }
  if (!key) {
    return null;
  }
  const mac = platform === "mac";
  const mods = new Set<Modifier>();
  if (!e.code && e.metaKey && e.ctrlKey) {
    mods.add("Mod");
  } else {
    if (mac ? e.metaKey : e.ctrlKey) {
      mods.add("Mod");
    }
    if (mac ? e.ctrlKey : e.metaKey) {
      mods.add(mac ? "Ctrl" : "Meta");
    }
  }
  if (e.altKey) {
    mods.add("Alt");
  }
  if (e.shiftKey) {
    mods.add("Shift");
  }
  return join(mods, key);
}

const MEMO_CAP = 2048;
interface ChordMemo {
  /** Plain/Shift letters, by `e.key`. */
  letter: Map<string, Chord | null>;
  /** Everything else with a `code`, by `code`. */
  code: Map<string, Chord | null>;
  /** Synthetic events without a `code`, by `e.key`. */
  noCode: Map<string, Chord | null>;
}
const newMemo = (): ChordMemo => ({
  letter: new Map(),
  code: new Map(),
  noCode: new Map(),
});
/** Per platform, one memo per 4-bit modifier mask (meta, ctrl, alt, shift). */
const MEMOS: Record<Platform, (ChordMemo | undefined)[]> = {
  mac: [],
  win: [],
  linux: [],
};

const isAsciiLetter = (key: unknown): boolean => {
  if (typeof key !== "string" || key.length !== 1) {
    return false;
  }
  const c = key.charCodeAt(0) | 32;
  return c >= 97 && c <= 122;
};

/**
 * `chordFromEventUncached` behind a memo: the result depends only on the
 * modifier mask plus `key` (plain letters), `code` (other keys) or `key` (no
 * `code`), so a keystroke costs a few property reads and one Map.get, with no
 * allocation. Maps are bounded (cleared at MEMO_CAP entries).
 */
export function chordFromEvent(
  e: KeyEventLike,
  platform: Platform,
): Chord | null {
  const mask =
    (e.metaKey ? 1 : 0) |
    (e.ctrlKey ? 2 : 0) |
    (e.altKey ? 4 : 0) |
    (e.shiftKey ? 8 : 0);
  const memos = MEMOS[platform];
  const memo = memos[mask] ?? (memos[mask] = newMemo());
  const code = e.code;
  let map: Map<string, Chord | null>;
  let k: string;
  if (code) {
    if ((mask & 7) === 0 && isAsciiLetter(e.key)) {
      map = memo.letter;
      k = e.key;
    } else {
      map = memo.code;
      k = code;
    }
  } else {
    map = memo.noCode;
    k = e.key;
  }
  let chord = map.get(k);
  if (chord === undefined) {
    chord = chordFromEventUncached(e, platform);
    if (map.size >= MEMO_CAP) {
      map.clear();
    }
    map.set(k, chord);
  }
  return chord;
}

const KEY_LABELS: Record<string, string> = {
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  BracketLeft: "[",
  BracketRight: "]",
  Quote: "'",
  Semicolon: ";",
  Minus: "-",
  Equal: "=",
  Backquote: "`",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Escape: "Esc",
  Delete: "Del",
  PageUp: "PgUp",
  PageDown: "PgDn",
  ContextMenu: "Menu",
  NumpadAdd: "Num +",
  NumpadSubtract: "Num -",
  NumpadMultiply: "Num *",
  NumpadDivide: "Num /",
  NumpadDecimal: "Num .",
  NumpadEnter: "Num Enter",
  NumpadEqual: "Num =",
};
const MAC_KEY_LABELS: Record<string, string> = {
  Enter: "↵",
  Backspace: "⌫",
  Delete: "⌦",
  Tab: "⇥",
};

const keyLabel = (key: string, mac: boolean) => {
  const label = (mac && MAC_KEY_LABELS[key]) || KEY_LABELS[key];
  if (label) {
    return label;
  }
  return /^Numpad\d$/.test(key) ? `Num ${key.slice(6)}` : key;
};

/** The keys of a chord one by one, for key caps: ["⇧", "⌘", "L"] or ["Ctrl", "L"]. */
export function formatChordParts(chord: Chord, platform: Platform): string[] {
  const parts = parseParts(chord);
  if (!parts) {
    return [chord];
  }
  const mac = platform === "mac";
  const label = keyLabel(parts.key, mac);
  const { mods } = parts;
  const names = mac
    ? [
        mods.has("Ctrl") && "⌃",
        mods.has("Alt") && "⌥",
        mods.has("Shift") && "⇧",
        // Mod and Meta are both Cmd here; Ctrl stays Control.
        (mods.has("Mod") || mods.has("Meta")) && "⌘",
      ]
    : [
        (mods.has("Mod") || mods.has("Ctrl")) && "Ctrl",
        mods.has("Alt") && "Alt",
        mods.has("Shift") && "Shift",
        mods.has("Meta") && "Meta",
      ];
  return [...names.filter((n): n is string => !!n), label];
}

/** Display text: mac "⌘⇧=", others "Ctrl+Shift+=". */
export function formatChord(chord: Chord, platform: Platform): string {
  return formatChordParts(chord, platform).join(platform === "mac" ? "" : "+");
}

/**
 * Words like Excalidraw's own menu labels: mac "Option+Cmd+J" (Ctrl stays
 * Ctrl), others "Ctrl+Alt+Shift+J". The palette keeps formatChord's symbols.
 */
export function formatChordWords(chord: Chord, platform: Platform): string {
  const parts = parseParts(chord);
  if (!parts) {
    return chord;
  }
  const { mods } = parts;
  const mac = platform === "mac";
  const names = mac
    ? [
        (mods.has("Mod") || mods.has("Meta")) && "Cmd",
        mods.has("Ctrl") && "Ctrl",
        mods.has("Shift") && "Shift",
        mods.has("Alt") && "Option",
      ]
    : [
        (mods.has("Mod") || mods.has("Ctrl")) && "Ctrl",
        mods.has("Meta") && "Meta",
        mods.has("Shift") && "Shift",
        mods.has("Alt") && "Alt",
      ];
  return [...names.filter(Boolean), keyLabel(parts.key, false)].join("+");
}

/** True when no Mod/Ctrl/Alt/Meta is held (Shift alone counts as free). */
export function isModifierFree(chord: Chord): boolean {
  const parts = parseParts(chord);
  if (!parts) {
    return false;
  }
  return !["Mod", "Ctrl", "Alt", "Meta"].some((m) =>
    parts.mods.has(m as Modifier),
  );
}
