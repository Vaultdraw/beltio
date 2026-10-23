import type { TagsResponse } from "../tags/types";

/** Vault search payloads (frozen contract, serde camelCase on the Rust side). */
export type IndexState = "loading" | "building" | "ready";

export type IndexStatus = {
  handle: string;
  state: IndexState;
  /** Drawings with content indexed. */
  indexed: number;
  /** Drawings known (walk so far). */
  total: number;
};

/** UTF-16 [start, end) offsets into the string they annotate. */
export type HighlightRange = [number, number];

export type ElementMatch = {
  elementId: string;
  /** Bound text: the shape/arrow it labels. */
  containerId: string | null;
  kind: "text" | "frame" | "formula";
  snippet: string;
  highlights: HighlightRange[];
};

export type SearchHit = {
  /** Vault-relative, forward slashes. */
  path: string;
  /** File name including ".excalidraw". */
  name: string;
  score: number;
  nameHighlights: HighlightRange[];
  /** At most 5 per drawing, best first. */
  matches: ElementMatch[];
  /** Total matching items in this drawing. */
  matchCount: number;
};

export type SearchResponse = {
  query: string;
  results: SearchHit[];
  /** Matching drawings before the limit. */
  totalMatches: number;
  status: IndexStatus;
  tookMs: number;
};

export type SearchScope = "all" | "names" | "content";

export type SearchOptions = { limit?: number; scope?: SearchScope };

/** Every drawing path the index knows (what `scope: "names"` searches). */
export type NamesListing = { paths: string[]; status: IndexStatus };

export interface VaultSearch {
  search(
    handle: string,
    query: string,
    opts?: SearchOptions,
  ): Promise<SearchResponse>;
  /** Vault-relative paths (forward slashes), sorted; fetched once per switcher open. */
  listNames(handle: string): Promise<NamesListing>;
  status(handle: string): Promise<IndexStatus>;
  tags(handle: string): Promise<TagsResponse>;
  subscribe(listener: (status: IndexStatus) => void): Promise<() => void>;
  /**
   * Starts the native index now if it is still pending (`search.start` idle
   * or use). Optional: without it, the first query starts the index.
   */
  start?(handle: string): Promise<void>;
}
