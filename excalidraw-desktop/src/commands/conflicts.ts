/** Conflicts between a command's keys and other commands, Excalidraw, reserved. */
import { defaultKeys } from "./commands";
import { excalidrawActionsFor } from "./excalidrawKeys";
import { effectiveKeys } from "./keymap";
import { reservedReason } from "./reserved";

import { normalizeChord } from "./keys";

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
  | { kind: "reserved"; reason: string };

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
  for (const command of commands) {
    const chords = effectiveKeys(command, overrides, platform);
    keys.set(command.id, chords);
    for (const chord of chords) {
      const list = users.get(chord);
      if (list) {
        list.push(command);
      } else {
        users.set(chord, [command]);
      }
    }
  }

  const result = new Map<string, Map<Chord, Conflict[]>>();
  for (const command of commands) {
    const defaults = defaultKeys(command, platform).map((c) =>
      normalizeChord(c, platform),
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
      if (!defaults.includes(chord)) {
        for (const key of excalidrawActionsFor(chord, platform)) {
          found.push({
            kind: "excalidraw",
            action: key.action,
            label: key.label,
          });
        }
      }
      const reason = reservedReason(chord, platform);
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

/** Number of (command, chord) pairs that have at least one conflict. */
export function conflictCount(conflicts: ConflictMap): number {
  let count = 0;
  for (const perChord of conflicts.values()) {
    count += perChord.size;
  }
  return count;
}
