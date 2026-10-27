/**
 * Test/harness-only graph transport over the fake repository and fake links: builds the same
 * `GraphData` the native `vault_graph` decodes to (drawings by path, then unresolved ghosts), keeps
 * the layout bytes in memory, and fakes the settings.toml commands the per-vault graph settings use.
 */
import { createGraphData } from "../../../plugins/official/graph/src/decode";
import {
  FLAG_ORPHAN,
  FLAG_UNRESOLVED,
} from "../../../plugins/official/graph/src/types";

import type { GraphSource } from "../../../plugins/official/graph/src/GraphSession";
import type { GraphData } from "../../../plugins/official/graph/src/types";
import type { VaultLinks } from "../links/types";
import type { VaultRepository } from "../vault/types";

const EXT = ".excalidraw";

/** Encodes a graph as the native `vault_graph` payload (the inverse of the plugin's `decodeGraph`). */
export function encodeGraph(g: GraphData): Uint8Array {
  const enc = new TextEncoder();
  const labels = Array.from({ length: g.nodeCount }, (_, i) =>
    enc.encode(g.label(i)),
  );
  const folders = Array.from({ length: g.folderCount }, (_, f) =>
    enc.encode(g.folderName(f)),
  );
  const nodeOff = new Uint32Array(g.nodeCount + 1);
  let at = 0;
  labels.forEach((l, i) => {
    nodeOff[i] = at;
    at += l.length;
  });
  nodeOff[g.nodeCount] = at;
  const folderOff = new Uint32Array(g.folderCount + 1);
  folders.forEach((l, i) => {
    folderOff[i] = at;
    at += l.length;
  });
  folderOff[g.folderCount] = at;
  const blob = new Uint8Array(at);
  [...labels, ...folders].reduce((pos, b) => {
    blob.set(b, pos);
    return pos + b.length;
  }, 0);
  const head = new Uint32Array([
    0x31474456,
    1,
    g.nodeCount,
    g.edgeCount,
    g.folderCount,
    at,
    0,
    0,
  ]);
  const parts = [
    head,
    g.folder,
    g.outDeg,
    g.inDeg,
    g.flags,
    g.edges,
    nodeOff,
    folderOff,
  ];
  const words = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(words * 4 + at);
  let pos = 0;
  for (const p of parts) {
    out.set(new Uint8Array(p.buffer, p.byteOffset, p.byteLength), pos);
    pos += p.byteLength;
  }
  out.set(blob, pos);
  return out;
}

async function drawingPaths(repo: VaultRepository, handle: string) {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const e of await repo.listDirectory(handle, dir)) {
      if (e.kind === "folder") {
        await walk(e.path);
      } else if (e.path.endsWith(EXT)) {
        out.push(e.path);
      }
    }
  };
  await walk("");
  return out.sort();
}

export class FakeVaultGraph implements GraphSource {
  layout: Uint8Array = new Uint8Array(0);
  /** Layout saves, for tests. */
  saves = 0;

  constructor(
    private readonly repo: VaultRepository,
    private readonly links: VaultLinks,
  ) {}

  async graph(handle: string): Promise<GraphData> {
    const paths = await drawingPaths(this.repo, handle);
    const index = new Map(paths.map((p, i) => [p, i]));
    const labels = paths.map((p) => p.slice(0, -EXT.length));
    const ghosts = new Map<string, number>();
    const edgeSet = new Set<string>();
    for (const [i, p] of paths.entries()) {
      const r = await this.links.links(handle, p);
      for (const l of r.outgoing) {
        const j = l.resolved ? index.get(l.resolved) : undefined;
        if (j !== undefined && j !== i) {
          edgeSet.add(`${i},${j}`);
        }
      }
      for (const l of r.unresolved) {
        let g = ghosts.get(l.target);
        if (g === undefined) {
          g = paths.length + ghosts.size;
          ghosts.set(l.target, g);
          labels.push(l.target);
        }
        edgeSet.add(`${i},${g}`);
      }
    }
    const n = labels.length;
    const edgeList = [...edgeSet]
      .map((k) => k.split(",").map(Number) as [number, number])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const edges = new Uint32Array(edgeList.length * 2);
    const outDeg = new Uint32Array(n);
    const inDeg = new Uint32Array(n);
    edgeList.forEach(([a, b], k) => {
      edges[2 * k] = a;
      edges[2 * k + 1] = b;
      outDeg[a]++;
      inDeg[b]++;
    });
    const folders = [""];
    const folder = new Uint32Array(n);
    const flags = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      if (i >= paths.length) {
        flags[i] = FLAG_UNRESOLVED;
        continue;
      }
      const top = paths[i].includes("/") ? paths[i].split("/")[0] : "";
      let f = folders.indexOf(top);
      if (f < 0) {
        f = folders.push(top) - 1;
      }
      folder[i] = f;
      if (outDeg[i] + inDeg[i] === 0) {
        flags[i] = FLAG_ORPHAN;
      }
    }
    return createGraphData(
      {
        nodeCount: n,
        edgeCount: edgeList.length,
        folderCount: folders.length,
        folder,
        outDeg,
        inDeg,
        flags,
        edges,
      },
      { label: (i) => labels[i], folderName: (f) => folders[f] },
    );
  }

  /** The `vault_graph` payload (VDG1) of the same graph: what `ctx.vault.graph.read()` returns. */
  async bytes(handle: string): Promise<Uint8Array> {
    return encodeGraph(await this.graph(handle));
  }

  async loadLayout(): Promise<Uint8Array> {
    return this.layout;
  }

  async saveLayout(_handle: string, bytes: Uint8Array): Promise<void> {
    this.layout = bytes;
    this.saves++;
  }
}
