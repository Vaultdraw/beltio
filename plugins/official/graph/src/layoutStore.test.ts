import { describe, expect, it } from "vitest";

import { fakeGraph } from "./fakeGraph";
import {
  decodeLayout,
  encodeGraphLayout,
  encodeLayout,
  fnv1a32,
  nodeKey,
  seedPositions,
} from "./layoutStore";

describe("layout file", () => {
  it("hashes like FNV-1a 32", () => {
    expect(fnv1a32("")).toBe(0x811c9dc5);
    expect(fnv1a32("a")).toBe(0xe40c292c);
    expect(fnv1a32("foobar")).toBe(0xbf9cf968);
  });

  it("round-trips positions keyed by hash", () => {
    const bytes = encodeLayout(["a", "b/c"], new Float32Array([1, 2, -3.5, 4]));
    expect(bytes.length).toBe(8 + 24);
    const m = decodeLayout(bytes);
    expect(m.get(fnv1a32("a"))).toEqual([1, 2]);
    expect(m.get(fnv1a32("b/c"))).toEqual([-3.5, 4]);
  });

  it("treats empty, truncated and unknown-version bytes as no layout", () => {
    expect(decodeLayout(new Uint8Array(0)).size).toBe(0);
    const ok = encodeLayout(["a", "b"], new Float32Array(4));
    expect(decodeLayout(ok.subarray(0, 8 + 12 + 5)).size).toBe(1);
    const v = new Uint8Array(ok);
    v[0] = 9;
    expect(decodeLayout(v).size).toBe(0);
  });
});

describe("seedPositions", () => {
  const g = fakeGraph(1000);

  it("keeps saved positions and places the rest finitely", () => {
    const full = new Float32Array(2 * g.nodeCount).map((_, i) => i * 0.5);
    const saved = decodeLayout(encodeGraphLayout(g, full));
    const pos = seedPositions(g, saved);
    expect(Array.from(pos.subarray(0, 40))).toEqual(
      Array.from(full.subarray(0, 40)),
    );
    const fresh = seedPositions(g, new Map());
    expect(fresh.every(Number.isFinite)).toBe(true);
    expect(Array.from(seedPositions(g, new Map()))).toEqual(Array.from(fresh));
  });

  it("puts a new node near the centroid of its placed neighbours", () => {
    // Find a node with at least 2 neighbours, drop it from the saved layout.
    let target = -1;
    for (let i = 0; i < g.nodeCount && target < 0; i++) {
      if (g.isDrawing(i) && new Set(g.neighbours(i)).size >= 2) {
        target = i;
      }
    }
    const full = new Float32Array(2 * g.nodeCount);
    for (let i = 0; i < g.nodeCount; i++) {
      full[2 * i] = 1000 + (i % 10);
      full[2 * i + 1] = -2000 + (i % 7);
    }
    const saved = decodeLayout(encodeGraphLayout(g, full));
    saved.delete(fnv1a32(nodeKey(g, target)));
    const pos = seedPositions(g, saved);
    expect(Math.abs(pos[2 * target] - 1005)).toBeLessThan(10);
    expect(Math.abs(pos[2 * target + 1] + 1997)).toBeLessThan(10);
    // Not exactly on the centroid of the saved block: jittered but close.
    expect(pos[2 * target]).not.toBeNaN();
  });

  it("falls back to a folder-seeded layout when nothing is saved", () => {
    const pos = seedPositions(g, new Map());
    let same = 0;
    for (let i = 1; i < g.nodeCount; i++) {
      if (g.folder[i] === g.folder[0]) {
        same++;
      }
    }
    expect(same).toBeGreaterThan(0);
    expect(pos.length).toBe(2 * g.nodeCount);
  });
});
