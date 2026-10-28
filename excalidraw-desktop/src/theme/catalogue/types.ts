/** The community themes catalogue: the list (`index.json`) and what the browser does with it. */

export type ThemeMode = "dark" | "light";

export interface CatalogueEntry {
  name: string;
  /** Path inside the themes repo, e.g. `Vesper/Vesper.json`. */
  path: string;
  author: string;
  description: string;
  tags: string[];
  modes: ThemeMode[];
  swatch: Partial<Record<ThemeMode, string[]>>;
  /** SHA-256 of the theme file; the download must match it. */
  sha256: string;
  /** Preview image paths inside the repo (may be empty). */
  previews: string[];
  credit?: string;
  licence?: string;
  homepage?: string;
}

export interface Catalogue<E = CatalogueEntry> {
  entries: E[];
  /** SHA-256 of the index file. */
  sha256: string;
  /** Unix seconds of the last successful fetch. */
  fetchedAt: number;
  /** The index address this came from. */
  url: string;
}

/** What a backend stores and returns for the index (snake_case, as Rust sends it). */
export interface RawIndex {
  json: string;
  sha256: string;
  fetched_at: number;
  url: string;
}

export interface CatalogueBackend {
  /** The cached index, with no network. */
  cached(): Promise<RawIndex | null>;
  /** Downloads the index and caches it. */
  refresh(url: string, maxBytes: number): Promise<RawIndex>;
  /** Bytes of a preview image (PNG, JPEG or WebP). */
  preview(url: string, maxBytes: number): Promise<Uint8Array>;
}

export type EntryStatus = "available" | "installed" | "update";

export interface LoadedCatalogue<E = CatalogueEntry> {
  catalogue: Catalogue<E>;
  /** True when the list came from the cache because the fetch failed. */
  stale: boolean;
  /** Why the fetch failed (shown next to the cached list). */
  notice?: string;
}
