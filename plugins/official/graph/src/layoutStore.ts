/**
 * Saved graph layout. File format (owned here; Rust stores the bytes opaquely, <= 16 MB):
 *   u32 version (1), u32 count, then per node [u32 fnv1a32(key), f32 x, f32 y] (12 B/node),
 *   little-endian. The key is the node label (vault path without extension), ghost targets are
 *   prefixed with "?" so they cannot collide with a drawing. A hash collision only costs a worse seed.
 */
import { FLAG_UNRESOLVED } from "./types";

import type { GraphData } from "./types";
import type { GraphSource } from "./GraphSession";

export const LAYOUT_VERSION = 1;
const NODE_BYTES = 12;

export type SavedLayout = Map<number, [number, number]>;

const encoder = new TextEncoder();

export function fnv1a32(text: string): number {
  const bytes = encoder.encode(text);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Stable per-node key: the label, with "?" for ghosts. */
export function nodeKey(graph: GraphData, i: number): string {
  return (graph.flags[i] & FLAG_UNRESOLVED ? "?" : "") + graph.label(i);
}

/** `positions` is x,y pairs aligned with `keys`. */
export function encodeLayout(
  keys: readonly string[],
  positions: Float32Array,
): Uint8Array {
  const n = keys.length;
  const out = new Uint8Array(8 + n * NODE_BYTES);
  const view = new DataView(out.buffer);
  view.setUint32(0, LAYOUT_VERSION, true);
  view.setUint32(4, n, true);
  for (let i = 0; i < n; i++) {
    const o = 8 + i * NODE_BYTES;
    view.setUint32(o, fnv1a32(keys[i]), true);
    view.setFloat32(o + 4, positions[2 * i], true);
    view.setFloat32(o + 8, positions[2 * i + 1], true);
  }
  return out;
}

export function encodeGraphLayout(
  graph: GraphData,
  positions: Float32Array,
): Uint8Array {
  const keys = new Array<string>(graph.nodeCount);
  for (let i = 0; i < keys.length; i++) {
    keys[i] = nodeKey(graph, i);
  }
  return encodeLayout(keys, positions);
}

/** Empty, truncated or unknown-version bytes decode to an empty map. */
export function decodeLayout(bytes: Uint8Array): SavedLayout {
  const saved: SavedLayout = new Map();
  if (bytes.byteLength < 8) {
    return saved;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== LAYOUT_VERSION) {
    return saved;
  }
  const n = Math.min(
    view.getUint32(4, true),
    Math.floor((bytes.byteLength - 8) / NODE_BYTES),
  );
  for (let i = 0; i < n; i++) {
    const o = 8 + i * NODE_BYTES;
    saved.set(view.getUint32(o, true), [
      view.getFloat32(o + 4, true),
      view.getFloat32(o + 8, true),
    ]);
  }
  return saved;
}

export async function loadLayout(
  client: Pick<GraphSource, "loadLayout">,
  handle: string,
): Promise<SavedLayout> {
  return decodeLayout(await client.loadLayout(handle));
}

export async function saveLayout(
  client: Pick<GraphSource, "saveLayout">,
  handle: string,
  graph: GraphData,
  positions: Float32Array,
): Promise<void> {
  await client.saveLayout(handle, encodeGraphLayout(graph, positions));
}

function rng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const JITTER = 5;

/**
 * Initial x,y for every node: saved positions kept; a new node goes at the centroid of its
 * already-placed neighbours plus a small jitter; the rest sit on a per-folder disc (centred on
 * the folder's saved nodes when it has any, else at a seeded spot, as in the layout spike).
 */
export function seedPositions(
  graph: GraphData,
  saved: SavedLayout,
  seed = 2,
): Float32Array {
  const n = graph.nodeCount;
  const pos = new Float32Array(2 * n);
  const placed = new Uint8Array(n);
  const r = rng(seed + n);
  const side = 15 * Math.sqrt(n);
  const fsize = new Uint32Array(graph.folderCount);
  const fsum = new Float64Array(2 * graph.folderCount);
  const fplaced = new Uint32Array(graph.folderCount);
  for (let i = 0; i < n; i++) {
    const f = graph.folder[i];
    fsize[f]++;
    const p = saved.get(fnv1a32(nodeKey(graph, i)));
    if (p) {
      pos[2 * i] = p[0];
      pos[2 * i + 1] = p[1];
      placed[i] = 1;
      fsum[2 * f] += p[0];
      fsum[2 * f + 1] += p[1];
      fplaced[f]++;
    }
  }
  const adj = saved.size ? graph.adjacency() : null;
  const rest: number[] = [];
  for (let i = 0; i < n; i++) {
    if (placed[i]) {
      continue;
    }
    let sx = 0;
    let sy = 0;
    let c = 0;
    if (adj) {
      for (let k = adj.offsets[i]; k < adj.offsets[i + 1]; k++) {
        const j = adj.targets[k];
        if (placed[j]) {
          sx += pos[2 * j];
          sy += pos[2 * j + 1];
          c++;
        }
      }
    }
    if (c === 0) {
      rest.push(i);
      continue;
    }
    const a = r() * 2 * Math.PI;
    const d = Math.sqrt(r()) * JITTER;
    pos[2 * i] = sx / c + Math.cos(a) * d;
    pos[2 * i + 1] = sy / c + Math.sin(a) * d;
    placed[i] = 1;
  }
  const cx = new Float64Array(graph.folderCount);
  const cy = new Float64Array(graph.folderCount);
  for (let f = 0; f < graph.folderCount; f++) {
    if (fplaced[f]) {
      cx[f] = fsum[2 * f] / fplaced[f];
      cy[f] = fsum[2 * f + 1] / fplaced[f];
    } else {
      cx[f] = (r() - 0.5) * side;
      cy[f] = (r() - 0.5) * side;
    }
  }
  for (const i of rest) {
    const f = graph.folder[i];
    const rad = 4 * Math.sqrt(fsize[f]);
    const a = r() * 2 * Math.PI;
    const d = Math.sqrt(r()) * rad;
    pos[2 * i] = cx[f] + Math.cos(a) * d;
    pos[2 * i + 1] = cy[f] + Math.sin(a) * d;
  }
  return pos;
}
