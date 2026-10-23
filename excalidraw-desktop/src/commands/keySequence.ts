/**
 * Key sequences: space-separated chords ("g g", "<leader> f f",
 * "Mod+Alt+K Mod+S") with Vim aliases. A stored key is a chord or a canonical
 * space-joined sequence; `<leader>` stays literal there and is expanded when
 * the trie is built (keyTrie.ts), so changing the leader needs no rewrite.
 */
import { formatChord, normalizeChord, parseChord } from "./keys";

import type { Chord, Platform } from "./types";

/** Options of the `[keys]` table that the resolver reads. */
export interface KeyOptions {
  /** Chord text `<leader>` expands to. */
  leader: string;
  /** Wait before the shorter of two overlapping bindings runs; 0 = wait for a key. */
  timeoutMs: number;
  /** Drop a half-typed sequence after this idle time; 0 = never. */
  cancelAfterMs: number;
}

export const DEFAULT_KEY_OPTIONS: KeyOptions = {
  leader: "Backslash",
  timeoutMs: 1000,
  cancelAfterMs: 5000,
};

export const LEADER_TOKEN = "<leader>";

/** A stored key with more than one chord (a chord never contains a space). */
export const isSequenceKey = (key: Chord): boolean => key.includes(" ");

const VIM_NAMES: Record<string, string> = {
  cr: "Enter",
  enter: "Enter",
  return: "Enter",
  esc: "Escape",
  space: "Space",
  tab: "Tab",
  bs: "Backspace",
  del: "Delete",
};
const VIM_MOD_NAMES: Record<string, string> = {
  c: "Ctrl",
  a: "Alt",
  s: "Shift",
};
const VIM_MODIFIED = /^((?:[csa]-)+)(.+)$/i;

/** `<C-x>`, `<CR>`, `<A-S-Tab>` ... as a canonical chord; null if unknown. */
function parseAngle(inner: string): Chord | null {
  const lower = inner.toLowerCase();
  const named = VIM_NAMES[lower];
  if (named) {
    return parseChord(named);
  }
  const modified = VIM_MODIFIED.exec(inner);
  if (modified) {
    const mods = modified[1]
      .toLowerCase()
      .split("-")
      .filter(Boolean)
      .map((m) => VIM_MOD_NAMES[m]);
    const key = VIM_NAMES[modified[2].toLowerCase()] ?? modified[2];
    return parseChord([...mods, key].join("+"));
  }
  return parseChord(inner);
}

function parseToken(token: string): Chord | null {
  if (token.length > 2 && token[0] === "<" && token.endsWith(">")) {
    return parseAngle(token.slice(1, -1));
  }
  return parseChord(token);
}

/**
 * Parse user text into chords. Tried as one old-style chord first ("Mod + S"
 * keeps working), else split on whitespace. `leader` is chord text for
 * `<leader>`, or LEADER_TOKEN to keep it literal. `platform` folds the
 * primary modifier into Mod; null leaves modifiers as typed (config parsing).
 * Null when any chord is invalid or the text is empty.
 */
export function parseSequence(
  text: string,
  platform: Platform | null,
  leader: string = DEFAULT_KEY_OPTIONS.leader,
): Chord[] | null {
  const fold = (chord: Chord) =>
    platform ? normalizeChord(chord, platform) : chord;
  const whole = parseChord(text);
  if (whole) {
    return [fold(whole)];
  }
  const tokens = text.trim().split(/\s+/);
  if (!tokens[0]) {
    return null;
  }
  let leaderChord: Chord | null | undefined;
  const chords: Chord[] = [];
  for (const token of tokens) {
    let chord: Chord | null;
    if (token.toLowerCase() === LEADER_TOKEN) {
      if (leaderChord === undefined) {
        leaderChord =
          leader === LEADER_TOKEN ? LEADER_TOKEN : parseToken(leader.trim());
      }
      chord = leaderChord;
      if (chord && chord !== LEADER_TOKEN) {
        chord = fold(chord);
      }
    } else {
      chord = parseToken(token);
      chord = chord && fold(chord);
    }
    if (!chord) {
      return null;
    }
    chords.push(chord);
  }
  // A lone literal <leader> never expands, so it would be a silently dead key.
  if (chords.length === 1 && chords[0] === LEADER_TOKEN) {
    return null;
  }
  return chords;
}

/** Canonical stored form of one key (chord or sequence); unparsable input is kept. */
export function normalizeKey(text: Chord, platform: Platform): Chord {
  if (!text.includes(" ") && !text.includes("<")) {
    return normalizeChord(text, platform);
  }
  const chords = parseSequence(text, platform, LEADER_TOKEN);
  return chords ? chords.join(" ") : text;
}

/** Normalised keys without duplicates; sequences stay intact. */
export const normalizeKeys = (
  keys: readonly Chord[],
  platform: Platform,
): Chord[] => [...new Set(keys.map((key) => normalizeKey(key, platform)))];

/** Display text of a stored key: chords formatted and joined by a space. */
export function formatSequence(
  key: Chord,
  platform: Platform,
  leader?: string,
): string {
  const chords = key.split(" ");
  return chords
    .map((chord) =>
      chord === LEADER_TOKEN && leader
        ? formatChord(parseChord(leader) ?? leader, platform)
        : formatChord(chord, platform),
    )
    .join(" ");
}

/**
 * May a sequence start while text is being edited? Only with Mod, Ctrl or
 * Alt, and not Ctrl+Alt without Meta (AltGr types characters).
 */
export function canStartInText(chord: Chord, platform: Platform): boolean {
  const mods = chord.split("+");
  mods.pop();
  if (mods.length === 0) {
    return false;
  }
  const primary = mods.includes("Mod");
  const ctrl = mods.includes("Ctrl");
  const alt = mods.includes("Alt");
  const meta = mods.includes("Meta");
  if (!primary && !ctrl && !alt) {
    return false;
  }
  // Mod is Ctrl on win/linux and Cmd on mac; AltGr = Ctrl+Alt without Cmd.
  const ctrlDown = platform === "mac" ? ctrl : primary;
  const cmdDown = platform === "mac" ? primary : meta;
  return !(ctrlDown && alt && !cmdDown);
}
