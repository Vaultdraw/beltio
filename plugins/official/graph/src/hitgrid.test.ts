import { describe, expect, it } from "vitest";

import { HitGrid } from "./hitgrid";
import { nodeZoomFactor } from "./renderer/shared";

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}

function randomNodes(n: number, extent = 2000) {
  const r = lcg(7);
  const pos = new Float32Array(2 * n);
  const rad = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    pos[2 * i] = (r() - 0.5) * extent;
    pos[2 * i + 1] = (r() - 0.5) * extent;
    rad[i] = 3 + r() * 6;
  }
  return { pos, rad };
}

function brute(
  pos: Float32Array,
  rad: Float32Array,
  n: number,
  wx: number,
  wy: number,
  scale: number,
  slop: number,
  mask?: Uint8Array,
) {
  const zf = nodeZoomFactor(scale);
  let best = -1;
  let bd = Infinity;
  for (let i = 0; i < n; i++) {
    if (mask?.[i]) {
      continue;
    }
    const dx = pos[2 * i] - wx;
    const dy = pos[2 * i + 1] - wy;
    const d = dx * dx + dy * dy;
    const r = (rad[i] * zf + slop) / scale;
    if (d <= r * r && d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

describe("HitGrid", () => {
  it("matches brute force at several zooms, with and without a mask", () => {
    const n = 3000;
    const { pos, rad } = randomNodes(n);
    const mask = new Uint8Array(n);
    for (let i = 0; i < n; i += 3) {
      mask[i] = 1;
    }
    const g = new HitGrid();
    const r = lcg(99);
    for (const m of [null, mask]) {
      g.build(pos, rad, n, m);
      for (const scale of [0.05, 0.3, 1, 3]) {
        for (let q = 0; q < 300; q++) {
          const wx = (r() - 0.5) * 2200;
          const wy = (r() - 0.5) * 2200;
          expect(g.pick(wx, wy, scale)).toBe(
            brute(pos, rad, n, wx, wy, scale, 2, m ?? undefined),
          );
        }
      }
    }
  });

  it("hits a node at its own position and misses empty space", () => {
    const pos = new Float32Array([0, 0, 100, 100]);
    const rad = new Float32Array([5, 5]);
    const g = new HitGrid();
    g.build(pos, rad, 2);
    expect(g.pick(0, 0, 1)).toBe(0);
    expect(g.pick(100.5, 99.5, 1)).toBe(1);
    expect(g.pick(50, 50, 1)).toBe(-1);
    expect(g.pick(1e6, 1e6, 1)).toBe(-1);
    expect(g.pick(-1e6, -1e6, 1)).toBe(-1);
  });

  it("handles empty graphs, coincident nodes and rebuilds with a different n", () => {
    const g = new HitGrid();
    g.build(new Float32Array(0), new Float32Array(0), 0);
    expect(g.pick(0, 0, 1)).toBe(-1);
    g.build(
      new Float32Array([1, 1, 1, 1, 1, 1]),
      new Float32Array([4, 4, 4]),
      3,
    );
    expect(g.pick(1, 1, 1)).toBeGreaterThanOrEqual(0);
    const { pos, rad } = randomNodes(500);
    g.build(pos, rad, 500);
    expect(g.pick(pos[10], pos[11], 1)).toBeGreaterThanOrEqual(0);
  });

  it("prefers the nearest of overlapping nodes", () => {
    const g = new HitGrid();
    g.build(new Float32Array([0, 0, 3, 0]), new Float32Array([8, 8]), 2);
    expect(g.pick(2.5, 0, 1)).toBe(1);
    expect(g.pick(0.4, 0, 1)).toBe(0);
  });
});
