/**
 * The half-typed key sequence, for the which-key popup. A tiny store: the
 * dispatcher writes it only while a sequence is pending, so it costs nothing
 * otherwise. Snapshots are immutable arrays (useSyncExternalStore friendly).
 */
import type { SeqRoot } from "./keyTrie";
import type { Chord, CommandContext, Platform } from "./types";

const NONE: readonly Chord[] = [];
let path: readonly Chord[] = NONE;
const listeners = new Set<() => void>();

export const getPendingKeys = (): readonly Chord[] => path;

export function setPendingKeys(next: readonly Chord[]): void {
  path = next.length > 0 ? [...next] : NONE;
  listeners.forEach((cb) => cb());
}

export function clearPendingKeys(): void {
  if (path !== NONE) {
    setPendingKeys(NONE);
  }
}

export function subscribePendingKeys(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** What the which-key popup reads from the installed dispatcher. */
export interface KeyView {
  platform: Platform;
  getSeqRoot(): SeqRoot;
  getContext(): CommandContext;
  hasHandler(id: string): boolean;
}

let keyView: KeyView | null = null;

/** Set by the dispatcher on install; null on uninstall. */
export const setKeyView = (view: KeyView | null): void => {
  keyView = view;
};

/** Clear the view only if it is still `view` (a newer dispatcher keeps its own). */
export const clearKeyView = (view: KeyView): void => {
  if (keyView === view) {
    keyView = null;
  }
};

export const getKeyView = (): KeyView | null => keyView;

let interceptor: ((chord: Chord) => boolean) | null = null;

/**
 * The open which-key popup claims ArrowUp/ArrowDown/Enter through this (the
 * dispatcher sees keys first). Returns a disposer; null interceptor = none.
 */
export function setKeyInterceptor(fn: (chord: Chord) => boolean): () => void {
  interceptor = fn;
  return () => {
    if (interceptor === fn) {
      interceptor = null;
    }
  };
}

export const getKeyInterceptor = () => interceptor;
