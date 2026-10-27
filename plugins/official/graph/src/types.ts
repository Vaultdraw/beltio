/**
 * Graph view data (P3). `GraphData` is the decoded `vault_graph` export (see
 * src-tauri/src/links/graph.rs for the `VDG1` binary format) and also what `fakeGraph.ts`
 * returns for tests, e2e and perf runs.
 *
 * Wire format (little-endian, u32 columns 4-byte aligned, UTF-8 blob last):
 *   header 8 x u32: magic "VDG1", version 1, nodeCount, edgeCount, folderCount, stringBytes, 0, 0
 *   folder u32[N], outDeg u32[N], inDeg u32[N], flags u32[N], edges u32[2E] (src,dst),
 *   nodeOff u32[N+1], folderOff u32[F+1], blob.
 * Node order: drawings by vault path, then unresolved (ghost) targets, then tags.
 */

export const FLAG_UNRESOLVED = 1;
export const FLAG_TAG = 2;
export const FLAG_ORPHAN = 4;

/** Undirected adjacency in CSR form; a mutual link a<->b lists each end twice. */
export interface Adjacency {
  /** `offsets[i]..offsets[i + 1]` is node i's slice of `targets`. */
  readonly offsets: Uint32Array;
  readonly targets: Uint32Array;
}

export interface GraphData {
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly folderCount: number;
  /** Top-level folder index per node (0 = vault root, also for ghosts and tags). */
  readonly folder: Uint32Array;
  readonly outDeg: Uint32Array;
  readonly inDeg: Uint32Array;
  /** FLAG_* bits. */
  readonly flags: Uint32Array;
  /** `(src, dst)` pairs, directed, deduplicated, no self loops, grouped by src. */
  readonly edges: Uint32Array;
  /** Display label: vault path without `.excalidraw`, ghost target, or `#tag`. */
  label(i: number): string;
  /** Vault path (with `.excalidraw`) of a drawing node, null for ghosts and tags. */
  path(i: number): string | null;
  folderName(f: number): string;
  /** True for a node that is a real drawing. */
  isDrawing(i: number): boolean;
  /** Undirected neighbours of node i (a view into the CSR, built on first use). */
  neighbours(i: number): Uint32Array;
  adjacency(): Adjacency;
}
