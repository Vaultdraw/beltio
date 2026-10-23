/** Conflicts between a command's keys and other commands, Excalidraw, reserved. */
import { defaultKeys } from "./commands";
import { excalidrawActionsFor } from "./excalidrawKeys";
import { effectiveKeys } from "./keymap";
import { reservedReason } from "./reserved";

import { normalizeKey } from "./keySequence";

import type {
  Chord,
  CommandDefinition,
  HotkeyOverrides,
  Platform,
  WhenClause,
} from "./types";

export type Conflict =
  | { kind: "command"; id: string; title: string }
  | { kind: "excalidraw"; action: string; label: string }
  | { kind: "reserved"; reason: string }
  /**
   * Warning only: one key is the start of the other ("g" and "g g"); the
   * longer sequence wins. `other` is the other binding as stored,
   * `otherIsLonger` tells which side this key is.
   */
  | {
      kind: "prefix";
      id: string;
      title: string;
      other: Chord;
      otherIsLonger: boolean;
    };

/** Focus scopes: focus is in at most one of them, so two different ones never hold together. */
const FOCUS_SCOPES: readonly string[] = [
  "canvasFocus",
  "listFocus",
  "galleryFocus",
  "graphFocus",
];

/** Two `when` lists can hold together unless one needs X and the other !X, or they need different focus scopes. */
export function whenCanOverlap(
  a: readonly WhenClause[] | undefined,
  b: readonly WhenClause[] | undefined,
): boolean {
  if (!a || !b) {
    return true;
  }
  const scopeA = a.find((clause) => FOCUS_SCOPES.includes(clause));
  const scopeB = b.find((clause) => FOCUS_SCOPES.includes(clause));
  if (scopeA && scopeB && scopeA !== scopeB) {
    return false;
  }
  return !a.some((clause) =>
    b.includes(
      (clause.startsWith("!") ? clause.slice(1) : `!${clause}`) as WhenClause,
    ),
  );
}

/** The chord that decides Excalidraw and reserved clashes: a sequence's first. */
const firstChord = (key: Chord): Chord => key.split(" ", 1)[0];

/** Every proper chord-prefix of a sequence as a stored key ("a b c" -> "a", "a b"). */
function* properPrefixes(key: Chord): Generator<Chord> {
  const chords = key.split(" ");
  for (let n = 1; n < chords.length; n++) {
    yield chords.slice(0, n).join(" ");
  }
}

type ConflictMap = ReadonlyMap<string, ReadonlyMap<Chord, Conflict[]>>;

/**
 * command id -> chord -> conflicts, only for pairs that have any. A chord that
 * is the command's own platform default is never flagged against Excalidraw:
 * those overlaps are deliberate (e.g. Mod+P, interface zoom).
 */
export function findConflicts(
  commands: readonly CommandDefinition[],
  overrides: HotkeyOverrides,
  platform: Platform,
): ConflictMap {
  const keys = new Map<string, Chord[]>();
  const users = new Map<Chord, CommandDefinition[]>();
  // prefix key -> commands with a longer sequence that starts with it.
  const longerUsers = new Map<Chord, [CommandDefinition, Chord][]>();
  const add = <V>(map: Map<Chord, V[]>, key: Chord, value: V) => {
    const list = map.get(key);
    if (list) {
      list.push(value);
    } else {
      map.set(key, [value]);
    }
  };
  for (const command of commands) {
    const chords = effectiveKeys(command, overrides, platform);
    keys.set(command.id, chords);
    for (const chord of chords) {
      add(users, chord, command);
      for (const prefix of properPrefixes(chord)) {
        add(longerUsers, prefix, [command, chord]);
      }
    }
  }

  const result = new Map<string, Map<Chord, Conflict[]>>();
  for (const command of commands) {
    const defaults = defaultKeys(command, platform).map((c) =>
      normalizeKey(c, platform),
    );
    for (const chord of keys.get(command.id) ?? []) {
      const found: Conflict[] = [];
      for (const other of users.get(chord) ?? []) {
        if (
          other.id !== command.id &&
          whenCanOverlap(command.when, other.when)
        ) {
          found.push({ kind: "command", id: other.id, title: other.title });
        }
      }
      const prefixConflict = (
        other: CommandDefinition,
        otherKey: Chord,
        otherIsLonger: boolean,
      ) => {
        if (
          other.id !== command.id &&
          whenCanOverlap(command.when, other.when)
        ) {
          found.push({
            kind: "prefix",
            id: other.id,
            title: other.title,
            other: otherKey,
            otherIsLonger,
          });
        }
      };
      for (const [other, otherKey] of longerUsers.get(chord) ?? []) {
        prefixConflict(other, otherKey, true);
      }
      for (const prefix of properPrefixes(chord)) {
        for (const other of users.get(prefix) ?? []) {
          prefixConflict(other, prefix, false);
        }
      }
      const first = firstChord(chord);
      if (!defaults.includes(chord)) {
        for (const key of excalidrawActionsFor(first, platform)) {
          if (isHostOwnedKey(key)) {
            continue;
          }
          found.push({
            kind: "excalidraw",
            action: key.action,
            label: key.label,
          });
        }
      }
      const reason = reservedReason(first, platform);
      if (reason) {
        found.push({ kind: "reserved", reason });
      }
      if (found.length > 0) {
        let perChord = result.get(command.id);
        if (!perChord) {
          perChord = new Map();
          result.set(command.id, perChord);
        }
        perChord.set(chord, found);
      }
    }
  }
  return result;
}

/** Tool letters and Q are `tool.*` commands (the app turns Excalidraw's own off), so they only clash command-to-command. */
const isHostOwnedKey = (key: { source: string; action: string }): boolean =>
  key.source === "tool" || key.action === "toolLock";

/** Number of (command, chord) pairs that have at least one conflict. */
export function conflictCount(conflicts: ConflictMap): number {
  let count = 0;
  for (const perChord of conflicts.values()) {
    count += perChord.size;
  }
  return count;
}
