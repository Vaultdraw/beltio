/** The community plugins registry: the list (`index.json`) and its entries. See sdk/docs/registry.md. */

export interface RegistryEntry {
  id: string;
  name: string;
  author: string;
  description: string;
  /** The version this entry's package holds (semantic version). */
  version: string;
  /** Plugin API level the package targets. */
  api: number;
  /** Oldest app version that runs it, when the package says so. */
  minApp?: string;
  /** Declared permissions, shown before install; the package must declare the same. */
  permissions: string[];
  /** SHA-256 of the zip; the download must match it. */
  sha256: string;
  /** The zip: an https address, or a path relative to the index. */
  url: string;
  /** Zip size in bytes, for the details view. */
  size?: number;
  homepage?: string;
  licence?: string;
}

export type RegistryStatus = "available" | "installed" | "update";
