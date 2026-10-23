/**
 * The half-typed key sequence, for the which-key popup. A tiny store: the
 * dispatcher writes it only while a sequence is pending, so it costs nothing
 * otherwise. Snapshots are immutable arrays (useSyncExternalStore friendly).
 */
import type { Chord } from "./types";

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
