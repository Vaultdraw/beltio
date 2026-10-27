/**
 * Local graph (P3): BFS from one node to depth 1-3 over an undirected CSR adjacency, returning
 * the node subset and the induced edges remapped to local ids.
 */

/** Undirected adjacency in CSR form (structurally the same as `Adjacency` in types.ts). */
export interface Csr {
  readonly offsets: Uint32Array;
  readonly targets: Uint32Array;
}

export interface LocalGraph {
  /** Global ids in BFS order, `nodes[0]` is the root. */
  readonly nodes: Uint32Array;
  /** BFS depth of each entry of `nodes` (0 for the root). */
  readonly depth: Uint8Array;
  /** `(src, dst)` pairs in local ids (indices into `nodes`), direction kept. */
  readonly edges: Uint32Array;
}

/** Build an undirected CSR from `(src, dst)` pairs; a mutual link lists each end twice. */
export function buildCsr(n: number, edges: Uint32Array): Csr {
  const offsets = new Uint32Array(n + 1);
  for (let i = 0; i < edges.length; i++) {
    offsets[edges[i] + 1]++;
  }
  for (let i = 0; i < n; i++) {
    offsets[i + 1] += offsets[i];
  }
  const targets = new Uint32Array(edges.length);
  const fill = offsets.slice(0, n);
  for (let k = 0; k < edges.length; k += 2) {
    const a = edges[k];
    const b = edges[k + 1];
    targets[fill[a]++] = b;
    targets[fill[b]++] = a;
  }
  return { offsets, targets };
}

export function localGraph(
  adj: Csr,
  edges: Uint32Array,
  root: number,
  depth: number,
): LocalGraph {
  const n = adj.offsets.length - 1;
  const local = new Int32Array(n).fill(-1);
  const order: number[] = [root];
  const depths: number[] = [0];
  local[root] = 0;
  const { offsets, targets } = adj;
  // Level by level: `order` doubles as the BFS queue.
  for (let head = 0; head < order.length; head++) {
    const d = depths[head];
    if (d >= depth) {
      break; // BFS order is level-sorted: everything after is at depth >= depth
    }
    const u = order[head];
    for (let p = offsets[u]; p < offsets[u + 1]; p++) {
      const v = targets[p];
      if (local[v] < 0) {
        local[v] = order.length;
        order.push(v);
        depths.push(d + 1);
      }
    }
  }
  const out: number[] = [];
  for (let k = 0; k < edges.length; k += 2) {
    const a = local[edges[k]];
    const b = local[edges[k + 1]];
    if (a >= 0 && b >= 0) {
      out.push(a, b);
    }
  }
  return {
    nodes: Uint32Array.from(order),
    depth: Uint8Array.from(depths),
    edges: Uint32Array.from(out),
  };
}
