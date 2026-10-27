import { describe, expect, it, vi } from "vitest";

import { LabelLayer, MAX_LABELS } from "./labels";

function grid(n: number, cols: number, gap: number) {
  const p = new Float32Array(2 * n);
  for (let i = 0; i < n; i++) {
    p[2 * i] = (i % cols) * gap;
    p[2 * i + 1] = Math.floor(i / cols) * gap;
  }
  return p;
}

const frame = (positions: Float32Array, scale: number, extra = {}) => ({
  positions,
  camera: { x: 0, y: 0, scale },
  width: 800,
  height: 600,
  ...extra,
});

describe("LabelLayer", () => {
  it("orders by degree and calls label() lazily", () => {
    const n = 5;
    const label = vi.fn((i: number) => `n${i}`);
    const L = new LabelLayer({ label, fadeScale: 0.1 });
    L.setGraph(n, [1, 9, 3, 0, 5]);
    const p = new Float32Array([0, 0, 0, 100, 0, 200, 0, 300, 0, 400]);
    L.layout(frame(p, 1, { camera: { x: 0, y: 150, scale: 1 } }));
    expect(Array.from(L.index.slice(0, L.count))).toEqual([1, 4, 2, 0, 3]);
    expect(label).toHaveBeenCalledTimes(5);
    // far off screen: nothing requested
    label.mockClear();
    L.layout(frame(p, 2, { camera: { x: 1e5, y: 1e5, scale: 2 } }));
    expect(L.count).toBe(0);
    expect(label).not.toHaveBeenCalled();
  });

  it("caps at 150 labels and never exceeds the candidate budget", () => {
    const n = 20000;
    const deg = new Uint32Array(n).fill(2);
    const label = vi.fn((i: number) => `x${i}`);
    const L = new LabelLayer({ label, fadeScale: 0.01 });
    L.setGraph(n, deg);
    const c = L.layout(
      frame(grid(n, 200, 50), 1, { camera: { x: 5000, y: 2500, scale: 1 } }),
    );
    expect(c).toBeLessThanOrEqual(MAX_LABELS);
    expect(c).toBe(MAX_LABELS);
    expect(label.mock.calls.length).toBeLessThanOrEqual(800 + 1);
  });

  it("culls colliding labels but keeps the more important one", () => {
    const L = new LabelLayer({ label: (i) => `node-${i}`, fadeScale: 0.01 });
    L.setGraph(3, [1, 10, 2]);
    // three nodes 3px apart: only the top-degree one fits
    const p = new Float32Array([400, 300, 403, 300, 406, 300]);
    expect(
      L.layout(frame(p, 1, { camera: { x: 400, y: 300, scale: 1 } })),
    ).toBe(1);
    expect(L.index[0]).toBe(1);
  });

  it("zoom LOD: low degree nodes appear only when zoomed in; alpha fades in", () => {
    const n = 100;
    const deg = new Uint32Array(n).fill(1);
    deg[0] = 100;
    const L = new LabelLayer({ label: (i) => `n${i}`, fadeScale: 0.5 });
    L.setGraph(n, deg);
    const p = grid(n, 10, 100);
    const cam = (s: number) => ({ camera: { x: 450, y: 450, scale: s } });
    const far = L.layout(frame(p, 0.05, cam(0.05)));
    expect(far).toBe(0);
    const mid = L.layout(frame(p, 0.2, cam(0.2)));
    expect(mid).toBeGreaterThanOrEqual(1);
    expect(L.index[0]).toBe(0);
    const near = L.layout(frame(p, 2, cam(2)));
    expect(near).toBeGreaterThan(mid);
    expect(L.alpha[0]).toBe(1);
  });

  it("hovered is always labelled (even colliding / zoomed out); neighbours come first", () => {
    const n = 50;
    const L = new LabelLayer({ label: (i) => `n${i}`, fadeScale: 5 });
    L.setGraph(n, new Uint32Array(n).fill(1));
    const p = grid(n, 10, 5);
    const c = L.layout(
      frame(p, 0.1, {
        camera: { x: 20, y: 10, scale: 0.1 },
        hovered: 7,
        always: [8, 9, 7],
      }),
    );
    expect(c).toBeGreaterThanOrEqual(1);
    expect(L.index[0]).toBe(7);
    expect(L.alpha[0]).toBe(1);
    expect(Array.from(L.index.slice(0, c)).filter((i) => i === 7)).toHaveLength(
      1,
    );
  });

  it("skips masked nodes and draws via the 2d context", () => {
    const L = new LabelLayer({ label: (i) => `n${i}`, fadeScale: 0.01 });
    L.setGraph(2, [1, 5]);
    const ctx = {
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      fillText: vi.fn(),
      font: "",
      fillStyle: "",
      textBaseline: "",
      globalAlpha: 1,
    };
    const p = new Float32Array([0, 0, 0, 50]);
    const n = L.draw(
      ctx as unknown as CanvasRenderingContext2D,
      frame(p, 1, {
        camera: { x: 0, y: 0, scale: 1 },
        mask: new Uint8Array([0, 1]),
      }),
      "#000",
      2,
    );
    expect(n).toBe(1);
    expect(ctx.fillText).toHaveBeenCalledTimes(1);
    expect(ctx.fillText.mock.calls[0][0]).toBe("n0");
    expect(ctx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
  });
});
