/** Effective keys per command (defaults + `[hotkeys]` overrides) and lookup. */
import { defaultKeys } from "./commands";
import { isSequenceKey, normalizeKeys } from "./keySequence";

import type {
  Chord,
  CommandDefinition,
  HotkeyOverrides,
  Platform,
} from "./types";

/** Normalised keys; sequences stay intact (each chord normalised). */
const normalizeAll = normalizeKeys;

const own = (overrides: HotkeyOverrides, id: string) =>
  Object.prototype.hasOwnProperty.call(overrides, id)
    ? overrides[id]
    : undefined;

/** The command's legacy-id override (minus `except`), if any. */
function legacyOverride(
  command: CommandDefinition,
  overrides: HotkeyOverrides,
  platform: Platform,
): Chord[] | undefined {
  const legacy = command.legacy;
  const keys = legacy && own(overrides, legacy.id);
  if (!keys) {
    return undefined;
  }
  const except = normalizeAll(legacy.except ?? [], platform);
  return normalizeAll(keys, platform).filter((c) => !except.includes(c));
}

/**
 * Override list when present (even []), else the legacy id's override, else
 * the platform defaults.
 */
export function effectiveKeys(
  command: CommandDefinition,
  overrides: HotkeyOverrides,
  platform: Platform,
): Chord[] {
  const override =
    own(overrides, command.id) ?? legacyOverride(command, overrides, platform);
  return normalizeAll(override ?? defaultKeys(command, platform), platform);
}

/**
 * What to store for `nextKeys`: null when they equal the defaults (the GUI
 * then deletes the TOML line), else the normalised list ([] = unassigned).
 */
export function overrideFor(
  command: CommandDefinition,
  nextKeys: readonly Chord[],
  platform: Platform,
): Chord[] | null {
  const next = normalizeAll(nextKeys, platform);
  const defaults = normalizeAll(defaultKeys(command, platform), platform);
  const same =
    next.length === defaults.length && next.every((c) => defaults.includes(c));
  return same ? null : next;
}

/** True when the effective keys differ from the defaults. */
export function isCustomised(
  command: CommandDefinition,
  overrides: HotkeyOverrides,
  platform: Platform,
): boolean {
  return (
    overrideFor(
      command,
      effectiveKeys(command, overrides, platform),
      platform,
    ) !== null
  );
}

/** Normalised chord -> commands bound to it, in registry order (single chords only). */
export function buildKeymap(
  commands: readonly CommandDefinition[],
  overrides: HotkeyOverrides,
  platform: Platform,
): ReadonlyMap<Chord, readonly CommandDefinition[]> {
  const map = new Map<Chord, CommandDefinition[]>();
  for (const command of commands) {
    for (const chord of effectiveKeys(command, overrides, platform)) {
      if (isSequenceKey(chord)) {
        continue; // sequences live in the trie (keyTrie.ts)
      }
      const list = map.get(chord);
      if (list) {
        list.push(command);
      } else {
        map.set(chord, [command]);
      }
    }
  }
  return map;
}
