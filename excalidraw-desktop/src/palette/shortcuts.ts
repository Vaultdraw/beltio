/** Shortcut labels for palette rows: one look for app and editor commands. */
import { getCommand } from "../commands/commands";
import { formatChord, normalizeChord, parseChord } from "../commands/keys";
import { effectiveKeys } from "../commands/keymap";
import { DEFAULT_KEY_OPTIONS, LEADER_TOKEN } from "../commands/keySequence";

import type { HotkeyOverrides, Platform } from "../commands/types";

type ChordFormat = (chord: string, platform: Platform) => string;

/** A stored chord as `format` shows it; `<leader>` becomes the leader key. */
function formatOne(
  chord: string,
  platform: Platform,
  leader: string,
  format: ChordFormat,
): string {
  return format(chord === LEADER_TOKEN ? leader : chord, platform);
}

/**
 * Display text of a stored key: a single chord exactly as `format` prints it,
 * a sequence as its chords joined by a space ("g g", mac "⌘⌥K ⌘S").
 */
export function formatKeyLabel(
  key: string,
  platform: Platform,
  leader: string = DEFAULT_KEY_OPTIONS.leader,
  format: ChordFormat = formatChord,
): string {
  return key
    .split(" ")
    .map((chord) => formatOne(chord, platform, leader, format))
    .join(" ");
}

/**
 * Key caps of a stored key, one array of caps per chord, for UI that draws a
 * cap group per chord. `capsOf` is formatChordParts.
 */
export function keyCapGroups(
  key: string,
  platform: Platform,
  capsOf: (chord: string, platform: Platform) => string[],
  leader: string = DEFAULT_KEY_OPTIONS.leader,
): string[][] {
  return key
    .split(" ")
    .map((chord) => capsOf(chord === LEADER_TOKEN ? leader : chord, platform));
}

/** First effective key of a registry command (rebinds included); "" = none. */
export function commandShortcutLabel(
  id: string,
  overrides: HotkeyOverrides,
  platform: Platform,
  format: ChordFormat = formatChord,
  leader: string = DEFAULT_KEY_OPTIONS.leader,
): string {
  const command = getCommand(id);
  const first = command && effectiveKeys(command, overrides, platform)[0];
  return first ? formatKeyLabel(first, platform, leader, format) : "";
}

/** Excalidraw prints "Option"/"Opt" for Alt on macOS; parseChord wants Alt. */
const OPTION = /\b(?:Option|Opt)\b/gi;

/**
 * Excalidraw's display shortcut ("Cmd+Shift+L", "Shift+Alt+D", "R") in our
 * notation ("⇧⌘L"); the raw text when it does not parse (e.g. "Space+drag").
 */
export function excalidrawShortcutLabel(
  raw: string | null | undefined,
  platform: Platform,
): string {
  if (!raw) {
    return "";
  }
  const chord = parseChord(raw.replace(OPTION, "Alt"));
  return chord ? formatChord(normalizeChord(chord, platform), platform) : raw;
}
