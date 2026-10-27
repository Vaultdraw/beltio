/**
 * Deterministic vault-like graph for tests, e2e and perf (ported from the layout spike's
 * graphgen.js): power-law folder sizes, ~70% intra-folder links, average degree ~3, 20% orphans,
 * a few hubs; plus ghost (unresolved) targets and tag nodes so every toggle has something to mask.
 * Returns the same `GraphData` as the native decoder.
 */
import { createGraphData } from "./decode";
import { FLAG_ORPHAN, FLAG_TAG, FLAG_UNRESOLVED } from "./types";

import type { GraphData } from "./types";

export const FAKE_SIZES = [1_000, 5_000, 10_000, 50_000] as const;

function rng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `n` drawings plus ~3% ghost nodes and ~12 tag nodes (so `nodeCount` is a little above n). */
export function fakeGraph(n: number, seed = 1): GraphData {
  const r = rng(seed * 7919 + n);
  const F = Math.max(5, Math.round(Math.sqrt(n) * 0.8));
  const cum = new Float64Array(F);
  for (let k = 0, s = 0; k < F; k++) {
    cum[k] = s += 1 / Math.pow(k + 1, 0.9);
  }
  const fol = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const x = r() * cum[F - 1];
    let lo = 0;
    let hi = F - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < x) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    fol[i] = lo;
  }
  // Drawings are ordered by folder then index, like sorted vault paths.
  const order = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => fol[a] - fol[b] || a - b,
  );
  const folderOf = new Uint32Array(n);
  const byFolder: number[][] = Array.from({ length: F }, () => []);
  const orphan = new Uint8Array(n);
  for (let c = 0, want = Math.round(n * 0.2); c < want; ) {
    const i = (r() * n) | 0;
    if (!orphan[i]) {
      orphan[i] = 1;
      c++;
    }
  }
  const linked: number[] = [];
  order.forEach((orig, node) => {
    folderOf[node] = fol[orig] + 1; // 0 is the vault root
    if (!orphan[orig]) {
      byFolder[fol[orig]].push(node);
      linked.push(node);
    }
  });

  const m = Math.round(n * 1.5);
  const seen = new Set<number>();
  const pairs: number[] = [];
  const add = (a: number, b: number) => {
    if (a === b) {
      return false;
    }
    const k = a < b ? a * n + b : b * n + a;
    if (seen.has(k)) {
      return false;
    }
    seen.add(k);
    pairs.push(a, b);
    return true;
  };
  const H = Math.max(3, Math.round(n / 3000));
  const hubDeg = Math.min(
    150 + Math.floor(r() * 250),
    Math.floor((0.15 * m) / H),
  );
  const pick = () => linked[(r() * linked.length) | 0];
  for (let h = 0; h < H; h++) {
    const hub = pick();
    for (let c = 0; c < hubDeg; ) {
      if (add(hub, pick())) {
        c++;
      }
    }
  }
  while (pairs.length / 2 < m) {
    const a = pick();
    const pool = byFolder[fol[order[a]]];
    const b =
      r() < 0.7 && pool.length > 1 ? pool[(r() * pool.length) | 0] : pick();
    add(a, b);
  }
  const ghosts = Math.round(n * 0.03);
  const tags = Math.min(12, Math.max(2, Math.round(Math.sqrt(n) / 8)));
  const N = n + ghosts + tags;
  for (let g = 0; g < ghosts; g++) {
    for (let c = 1 + ((r() * 3) | 0); c > 0; c--) {
      pairs.push(pick(), n + g);
    }
  }
  for (let i = 0; i < n; i++) {
    if (r() < 0.3) {
      pairs.push(i, n + ghosts + ((r() * tags) | 0));
    }
  }

  // Group by src (stable counting sort), dedupe per src.
  const count = new Uint32Array(N + 1);
  for (let k = 0; k < pairs.length; k += 2) {
    count[pairs[k] + 1]++;
  }
  for (let i = 0; i < N; i++) {
    count[i + 1] += count[i];
  }
  const dstOf = new Uint32Array(pairs.length / 2);
  const fill = count.slice(0, N);
  for (let k = 0; k < pairs.length; k += 2) {
    dstOf[fill[pairs[k]]++] = pairs[k + 1];
  }
  const out: number[] = [];
  for (let s = 0; s < N; s++) {
    const seg = Array.from(dstOf.subarray(count[s], count[s + 1])).sort(
      (a, b) => a - b,
    );
    seg.forEach((d, k) => {
      if (k === 0 || d !== seg[k - 1]) {
        out.push(s, d);
      }
    });
  }
  const edges = Uint32Array.from(out);
  const outDeg = new Uint32Array(N);
  const inDeg = new Uint32Array(N);
  const flags = new Uint32Array(N);
  const real = new Uint8Array(n);
  for (let k = 0; k < edges.length; k += 2) {
    outDeg[edges[k]]++;
    inDeg[edges[k + 1]]++;
    if (edges[k + 1] < n) {
      real[edges[k]] = 1;
      real[edges[k + 1]] = 1;
    } else if (edges[k + 1] < n + ghosts) {
      real[edges[k]] = 1;
    }
  }
  for (let i = 0; i < n; i++) {
    if (!real[i]) {
      flags[i] = FLAG_ORPHAN;
    }
  }
  flags.fill(FLAG_UNRESOLVED, n, n + ghosts);
  flags.fill(FLAG_TAG, n + ghosts, N);
  const folder = new Uint32Array(N);
  folder.set(folderOf);
  const label = (i: number) =>
    i < n
      ? `f${folder[i] - 1}/Drawing ${i}`
      : i < n + ghosts
      ? `missing ${i - n}`
      : `#tag${i - n - ghosts}`;
  return createGraphData(
    {
      nodeCount: N,
      edgeCount: edges.length / 2,
      folderCount: F + 1,
      folder,
      outDeg,
      inDeg,
      flags,
      edges,
    },
    { label, folderName: (f) => (f === 0 ? "" : `f${f - 1}`) },
  );
}
