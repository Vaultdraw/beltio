/**
 * Tabs (F5): per-tab undo snapshots under an LRU byte budget (PLAN.md §2).
 * Generic over the snapshot type, so it does not depend on packages/excalidraw.
 * View state is NOT stored here (it lives on the Tab record, never evicted).
 * No React, no IO, no timers.
 */
import type { TabId } from "./types";

type Entry<S> = {
  path: string;
  revision: number | string;
  snapshot: S;
  bytes: number;
};

export type TabMemoryOptions = {
  budgetBytes: number;
  /** Pinned tabs are evicted last (Chrome's pinned exemption). */
  isPinned: (tabId: TabId) => boolean;
};

/**
 * Rough memory cost of a value: JSON string length * 2 (UTF-16 code units).
 * An ESTIMATE, computed once at capture with a single JSON.stringify; it
 * ignores object overhead and shared references. Unserializable values count 0.
 */
export function estimateBytes(value: unknown): number {
  try {
    return (JSON.stringify(value) ?? "").length * 2;
  } catch {
    return 0;
  }
}

export class TabMemory<S> {
  /** Map insertion order = recency: first is least recently put/touched. */
  private entries = new Map<TabId, Entry<S>>();
  private budget: number;
  private total = 0;
  private readonly isPinned: (tabId: TabId) => boolean;

  constructor({ budgetBytes, isPinned }: TabMemoryOptions) {
    this.budget = Math.max(0, budgetBytes);
    this.isPinned = isPinned;
  }

  get totalBytes(): number {
    return this.total;
  }

  get size(): number {
    return this.entries.size;
  }

  has(tabId: TabId): boolean {
    return this.entries.has(tabId);
  }

  /** Store a snapshot as the most recent entry, then evict down to budget. */
  put(
    tabId: TabId,
    entry: {
      path: string;
      revision: number | string;
      snapshot: S;
      bytes: number;
    },
  ): void {
    this.delete(tabId);
    const bytes = Math.max(0, entry.bytes);
    if (this.budget === 0 || bytes > this.budget) {
      return; // larger than the whole budget (or budget 0): not kept
    }
    this.entries.set(tabId, { ...entry, bytes });
    this.total += bytes;
    this.evict();
  }

  /**
   * Remove and return the snapshot only when path and revision both match;
   * otherwise drop the entry and return null (never a wrong document's undo).
   */
  take(tabId: TabId, path: string, revision: number | string): S | null {
    const e = this.entries.get(tabId);
    if (!e) {
      return null;
    }
    this.delete(tabId);
    return e.path === path && e.revision === revision ? e.snapshot : null;
  }

  /** The revision the tab's kept state belongs to, when it is for `path` (outside renames). */
  revisionOf(tabId: TabId, path: string): number | string | null {
    const e = this.entries.get(tabId);
    return e && e.path === path ? e.revision : null;
  }

  /** Mark an entry most recently used (without changing it). */
  touch(tabId: TabId): void {
    const e = this.entries.get(tabId);
    if (e) {
      this.entries.delete(tabId);
      this.entries.set(tabId, e);
    }
  }

  delete(tabId: TabId): void {
    const e = this.entries.get(tabId);
    if (e) {
      this.total -= e.bytes;
      this.entries.delete(tabId);
    }
  }

  /**
   * In-app rename/move: a rename keeps the file and its revision, so undo
   * survives. Folder-prefix semantics: "a/b" matches "a/b" and "a/b/x", not "a/bc".
   */
  renamePath(from: string, to: string): void {
    for (const e of this.entries.values()) {
      if (e.path === from) {
        e.path = to;
      } else if (e.path.startsWith(`${from}/`)) {
        e.path = to + e.path.slice(from.length);
      }
    }
  }

  setBudget(budgetBytes: number): void {
    this.budget = Math.max(0, budgetBytes);
    if (this.budget === 0) {
      this.clear();
      return;
    }
    this.evict();
  }

  clear(): void {
    this.entries.clear();
    this.total = 0;
  }

  /** Whole stacks, least recent first; unpinned before pinned. */
  private evict(): void {
    if (this.total <= this.budget) {
      return;
    }
    for (const pinnedPass of [false, true]) {
      for (const id of [...this.entries.keys()]) {
        if (this.total <= this.budget) {
          return;
        }
        if (this.isPinned(id) === pinnedPass) {
          this.delete(id);
        }
      }
    }
  }
}
