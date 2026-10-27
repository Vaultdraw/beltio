// Report-only: `npx vitest run src/graph/decode.bench.test.ts` prints the numbers.
import { describe, it } from "vitest";

import { buildAdjacency } from "./decode";
import { fakeGraph } from "./fakeGraph";
import { decodeGraph } from "./decode";
import { encodeGraphLayout, decodeLayout, seedPositions } from "./layoutStore";

/** Same encoder as graph.rs, so decode is measured on a realistic payload. */
function encode(g: ReturnType<typeof fakeGraph>): Uint8Array {
  const enc = new TextEncoder();
  const labels = Array.from({ length: g.nodeCount }, (_, i) =>
    enc.encode(g.label(i)),
  );
  const folders = Array.from({ length: g.folderCount }, (_, f) =>
    enc.encode(g.folderName(f)),
  );
  const strBytes = [...labels, ...folders].reduce((s, b) => s + b.length, 0);
  const n = g.nodeCount;
  const words = 8 + 4 * n + 2 * g.edgeCount + n + 1 + g.folderCount + 1;
  const buf = new ArrayBuffer(words * 4 + strBytes);
  const u = new Uint32Array(buf, 0, words);
  u.set([0x31474456, 1, n, g.edgeCount, g.folderCount, strBytes, 0, 0]);
  let at = 8;
  for (const col of [g.folder, g.outDeg, g.inDeg, g.flags, g.edges]) {
    u.set(col, at);
    at += col.length;
  }
  const blob = new Uint8Array(buf, words * 4);
  let off = 0;
  let w = at;
  for (const group of [labels, folders]) {
    u[w++] = off;
    for (const b of group) {
      blob.set(b, off);
      off += b.length;
      u[w++] = off;
    }
  }
  return new Uint8Array(buf);
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
function time(iters: number, f: () => void): number {
  const t: number[] = [];
  for (let i = 0; i < iters; i++) {
    const s = performance.now();
    f();
    t.push(performance.now() - s);
  }
  return median(t);
}

describe("graph decode bench (report only)", () => {
  it("prints decode, adjacency and seed timings", () => {
    const rows: string[] = [];
    for (const n of [1_000, 10_000, 50_000]) {
      const g = fakeGraph(n);
      const bytes = encode(g);
      const decode = time(15, () => decodeGraph(bytes));
      const labels = time(5, () => {
        const d = decodeGraph(bytes);
        for (let i = 0; i < d.nodeCount; i++) {
          d.label(i);
        }
      });
      const adj = time(15, () => buildAdjacency(g.nodeCount, g.edges));
      const saved = decodeLayout(
        encodeGraphLayout(g, new Float32Array(2 * g.nodeCount)),
      );
      const seedFull = time(5, () => seedPositions(g, saved));
      const seedNone = time(5, () => seedPositions(g, new Map()));
      rows.push(
        `n=${n} nodes=${g.nodeCount} edges=${g.edgeCount} bytes=${
          bytes.length
        } (${(bytes.length / g.nodeCount).toFixed(
          1,
        )} B/node) decode=${decode.toFixed(
          3,
        )}ms decode+allLabels=${labels.toFixed(2)}ms adjacency=${adj.toFixed(
          2,
        )}ms seed(saved)=${seedFull.toFixed(1)}ms seed(none)=${seedNone.toFixed(
          1,
        )}ms`,
      );
    }
    // eslint-disable-next-line no-console
    console.log(`\n${rows.join("\n")}`);
  });
});
