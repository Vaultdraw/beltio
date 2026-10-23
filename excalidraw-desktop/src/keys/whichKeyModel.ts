/**
 * Which-key entries, generated from the sequence trie: the children of the
 * pending node that still have a live path (a descendant command whose `when`
 * holds and that has a handler). Pure: no React, no DOM.
 */
import { whenHolds } from "../commands/context";
import { parseSequence } from "../commands/keySequence";

import type { SeqNode, SeqRoot } from "../commands/keyTrie";
import type {
  Chord,
  CommandContext,
  CommandDefinition,
  Platform,
} from "../commands/types";

export interface WhichKeyEntry {
  chord: Chord;
  /** Command title, group label, or "+N more". */
  label: string;
  kind: "command" | "group";
  /** Some command below (or at) this entry can run now. */
  live: boolean;
}

export interface WhichKeyInput {
  root: SeqRoot;
  /** Chords typed so far; empty = the root entries. */
  path: readonly Chord[];
  ctx: CommandContext;
  hasHandler(id: string): boolean;
  /** Output of `resolveLabels`. */
  labels: ReadonlyMap<string, string>;
}

/**
 * `[keys.labels]` keys are sequences as written ("g g", "<leader> f"); the trie
 * holds expanded chords. Re-key by the expanded form.
 */
export function resolveLabels(
  labels: Readonly<Record<string, string>>,
  platform: Platform,
  leader: string,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, label] of Object.entries(labels)) {
    const chords = parseSequence(key, platform, leader);
    if (chords) {
      out.set(chords.join(" "), label);
    }
  }
  return out;
}

export function nodeAt(
  root: SeqRoot,
  path: readonly Chord[],
): SeqNode | ReadonlyMap<Chord, SeqNode> | null {
  if (!root) {
    return null;
  }
  if (path.length === 0) {
    return root;
  }
  let node = root.get(path[0]);
  for (let i = 1; node && i < path.length; i++) {
    node = node.next?.get(path[i]);
  }
  return node ?? null;
}

/** The first command at `node` that could run now. */
function runnableAt(
  node: SeqNode,
  ctx: CommandContext,
  hasHandler: (id: string) => boolean,
): CommandDefinition | null {
  for (const command of node.commands ?? []) {
    if (whenHolds(command.when, ctx) && hasHandler(command.id)) {
      return command;
    }
  }
  return null;
}

/** Number of runnable commands at or below `node`. */
function countLive(
  node: SeqNode,
  ctx: CommandContext,
  hasHandler: (id: string) => boolean,
): number {
  let n = 0;
  for (const command of node.commands ?? []) {
    if (whenHolds(command.when, ctx) && hasHandler(command.id)) {
      n++;
    }
  }
  for (const child of node.next?.values() ?? []) {
    n += countLive(child, ctx, hasHandler);
  }
  return n;
}

/** Entries below `path`, live ones first-class; dead ones carry `live: false`. */
export function buildEntries(
  input: WhichKeyInput,
  onlyLive = true,
): WhichKeyEntry[] {
  const { path, ctx, hasHandler, labels } = input;
  const at = nodeAt(input.root, path);
  if (!at) {
    return [];
  }
  const children: ReadonlyMap<Chord, SeqNode> | null =
    path.length === 0
      ? (at as ReadonlyMap<Chord, SeqNode>)
      : (at as SeqNode).next;
  const entries: WhichKeyEntry[] = [];
  for (const [chord, node] of children ?? []) {
    const live = countLive(node, ctx, hasHandler);
    if (live === 0 && onlyLive) {
      continue;
    }
    const own = runnableAt(node, ctx, hasHandler);
    let below = 0;
    for (const child of node.next?.values() ?? []) {
      below += countLive(child, ctx, hasHandler);
    }
    if (below === 0) {
      entries.push({
        chord,
        label: own?.title ?? node.commands?.[0]?.title ?? chord,
        kind: "command",
        live: live > 0,
      });
      continue;
    }
    const label =
      labels.get([...path, chord].join(" ")) ?? own?.title ?? `+${below} more`;
    entries.push({ chord, label, kind: "group", live: live > 0 });
  }
  return entries;
}
