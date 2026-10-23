/**
 * Sequence trie, built beside the flat chord map. Only multi-chord keys go in;
 * the result is null when none is configured, so the dispatcher's idle cost
 * for everyone else is one `Map.get`.
 */
import { effectiveKeys } from "./keymap";
import {
  LEADER_TOKEN,
  isSequenceKey,
  parseSequence,
  DEFAULT_KEY_OPTIONS,
} from "./keySequence";

import type {
  Chord,
  CommandDefinition,
  HotkeyOverrides,
  Platform,
} from "./types";

export interface SeqNode {
  /** Continuations; null for a leaf. */
  next: Map<Chord, SeqNode> | null;
  /** Commands bound to the sequence ending here; null if none. */
  commands: CommandDefinition[] | null;
}

/** First chord -> node; null when no sequence is configured. */
export type SeqRoot = ReadonlyMap<Chord, SeqNode> | null;

/** The chords of a stored key with `<leader>` expanded; null if invalid. */
function expand(
  key: Chord,
  platform: Platform,
  leader: string,
): Chord[] | null {
  const chords = key.split(" ");
  if (!chords.includes(LEADER_TOKEN)) {
    return chords;
  }
  return parseSequence(key, platform, leader);
}

export function buildKeyTrie(
  commands: readonly CommandDefinition[],
  overrides: HotkeyOverrides,
  options: { leader: string } = DEFAULT_KEY_OPTIONS,
  platform: Platform,
): SeqRoot {
  let root: Map<Chord, SeqNode> | null = null;
  for (const command of commands) {
    for (const key of effectiveKeys(command, overrides, platform)) {
      if (!isSequenceKey(key)) {
        continue;
      }
      const chords = expand(key, platform, options.leader);
      if (!chords || chords.length < 2) {
        continue;
      }
      root ??= new Map();
      let level: Map<Chord, SeqNode> = root;
      let node: SeqNode | undefined;
      for (let i = 0; i < chords.length; i++) {
        node = level.get(chords[i]);
        if (!node) {
          node = { next: null, commands: null };
          level.set(chords[i], node);
        }
        if (i < chords.length - 1) {
          level = node.next ?? (node.next = new Map());
        }
      }
      const last = node as SeqNode;
      (last.commands ??= []).push(command);
    }
  }
  return root;
}
