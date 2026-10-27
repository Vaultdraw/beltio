/** A drawing file's extension (the app's `DRAWING_EXT`). */
import { FLAG_TAG, FLAG_UNRESOLVED } from "./types";

import type { Adjacency, GraphData } from "./types";

const DRAWING_EXT = ".excalidraw";

const MAGIC = 0x31474456; // "VDG1" little-endian
const VERSION = 1;
const HEADER_WORDS = 8;
const EXT = DRAWING_EXT;

export class GraphDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraphDecodeError";
  }
}

export interface GraphColumns {
  nodeCount: number;
  edgeCount: number;
  folderCount: number;
  folder: Uint32Array;
  outDeg: Uint32Array;
  inDeg: Uint32Array;
  flags: Uint32Array;
  edges: Uint32Array;
}

export interface GraphStrings {
  label(i: number): string;
  folderName(f: number): string;
}

/** Undirected CSR adjacency (two passes over the edge list). */
export function buildAdjacency(
  nodeCount: number,
  edges: Uint32Array,
): Adjacency {
  const offsets = new Uint32Array(nodeCount + 1);
  for (let k = 0; k < edges.length; k++) {
    offsets[edges[k] + 1]++;
  }
  for (let i = 0; i < nodeCount; i++) {
    offsets[i + 1] += offsets[i];
  }
  const targets = new Uint32Array(edges.length);
  const fill = offsets.slice(0, nodeCount);
  for (let k = 0; k < edges.length; k += 2) {
    const a = edges[k];
    const b = edges[k + 1];
    targets[fill[a]++] = b;
    targets[fill[b]++] = a;
  }
  return { offsets, targets };
}

/** Wraps columns and string accessors into a `GraphData` (shared by the decoder and fakes). */
export function createGraphData(
  cols: GraphColumns,
  strings: GraphStrings,
): GraphData {
  let adj: Adjacency | null = null;
  const adjacency = () => (adj ??= buildAdjacency(cols.nodeCount, cols.edges));
  return {
    ...cols,
    label: (i) => strings.label(i),
    folderName: (f) => strings.folderName(f),
    path: (i) =>
      cols.flags[i] & (FLAG_UNRESOLVED | FLAG_TAG)
        ? null
        : strings.label(i) + EXT,
    isDrawing: (i) => (cols.flags[i] & (FLAG_UNRESOLVED | FLAG_TAG)) === 0,
    adjacency,
    neighbours: (i) => {
      const a = adjacency();
      return a.targets.subarray(a.offsets[i], a.offsets[i + 1]);
    },
  };
}

/** Decodes a `vault_graph` payload into zero-copy typed-array views; strings decode on demand. */
export function decodeGraph(input: ArrayBuffer | Uint8Array): GraphData {
  let buf: ArrayBuffer;
  let start = 0;
  let length: number;
  if (ArrayBuffer.isView(input)) {
    buf = input.buffer as ArrayBuffer;
    start = input.byteOffset;
    length = input.byteLength;
    if (start % 4 !== 0) {
      buf = input.slice().buffer as ArrayBuffer;
      start = 0;
    }
  } else {
    buf = input;
    length = input.byteLength;
  }
  if (length < HEADER_WORDS * 4) {
    throw new GraphDecodeError("Graph payload is too short");
  }
  const h = new Uint32Array(buf, start, HEADER_WORDS);
  if (h[0] !== MAGIC || h[1] !== VERSION) {
    throw new GraphDecodeError("Unknown graph format");
  }
  const [, , n, e, f, stringBytes] = h;
  const words = HEADER_WORDS + 4 * n + 2 * e + (n + 1) + (f + 1);
  if (length !== words * 4 + stringBytes) {
    throw new GraphDecodeError("Graph payload has the wrong size");
  }
  let at = start + HEADER_WORDS * 4;
  const take = (count: number): Uint32Array => {
    const v = new Uint32Array(buf, at, count);
    at += count * 4;
    return v;
  };
  const cols: GraphColumns = {
    nodeCount: n,
    edgeCount: e,
    folderCount: f,
    folder: take(n),
    outDeg: take(n),
    inDeg: take(n),
    flags: take(n),
    edges: take(2 * e),
  };
  const nodeOff = take(n + 1);
  const folderOff = take(f + 1);
  const blob = new Uint8Array(buf, at, stringBytes);
  const dec = new TextDecoder();
  // Node labels come first in the blob, folder names after them.
  const str = (off: Uint32Array, i: number) =>
    dec.decode(blob.subarray(off[i], off[i + 1]));
  return createGraphData(cols, {
    label: (i) => str(nodeOff, i),
    folderName: (k) => str(folderOff, k),
  });
}
