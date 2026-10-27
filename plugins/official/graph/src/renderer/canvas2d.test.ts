import { describe, expect, it } from "vitest";

import { Canvas2DRenderer, EDGE_SKIP_COUNT } from "./canvas2d";
import { fakeCanvas, recordingCtx, sampleGraph } from "./fakes";
import { NODE_HOLLOW, NODE_RING } from "./types";

const theme = {
  background: "#ffffff",
  edge: "#888888",
  edgeHighlight: "#0000ff",
  label: "#000",
  accent: "#ff8800",
};

function make(n = 5) {
  const { ctx, calls } = recordingCtx();
  const canvas = fakeCanvas(() => ctx);
  const r = new Canvas2DRenderer(canvas, ctx);
  r.resize(800, 600, 2);
  r.setTheme(theme);
  const g = sampleGraph(n);
  r.setGraph(g);
  const pos = new Float32Array(2 * n);
  for (let i = 0; i < n; i++) {
    pos[2 * i] = (i - 2) * 50;
    pos[2 * i + 1] = 0;
  }
  r.setPositions(pos);
  return { r, calls, g, canvas };
}

const count = (calls: Array<[string, ...unknown[]]>, name: string) =>
  calls.filter((c) => c[0] === name).length;

describe("Canvas2DRenderer", () => {
  it("batches: one edge path, one fill per colour group", () => {
    const { r, calls } = make();
    r.setCamera({ x: 0, y: 0, scale: 1 });
    calls.length = 0;
    r.draw();
    expect(count(calls, "stroke")).toBe(1);
    expect(count(calls, "fill")).toBe(1);
    expect(count(calls, "arc")).toBe(5);
    expect(count(calls, "lineTo")).toBe(4);
  });

  it("hidden nodes and their edges are not drawn", () => {
    const { r, calls } = make();
    r.setMask(new Uint8Array([0, 0, 1, 0, 0]));
    calls.length = 0;
    r.draw();
    expect(count(calls, "arc")).toBe(4);
    expect(count(calls, "lineTo")).toBe(2); // edges 1-2 and 2-3 dropped
  });

  it("highlight: neighbours bright, others dimmed, hovered edges stroked separately", () => {
    const { r, calls } = make();
    r.setHighlight({
      hovered: 1,
      neighbours: new Uint8Array([1, 1, 1, 0, 0]),
      dimAlpha: 0.12,
    });
    calls.length = 0;
    r.draw();
    expect(calls.some((c) => c[0] === "set:globalAlpha" && c[1] === 0.12)).toBe(
      true,
    );
    expect(count(calls, "fill")).toBe(2); // bright pass + dim pass
    expect(count(calls, "stroke")).toBe(2); // base edges + highlighted edges
  });

  it("flags: hollow strokes, ring adds a second stroke", () => {
    const { ctx, calls } = recordingCtx();
    const r = new Canvas2DRenderer(
      fakeCanvas(() => ctx),
      ctx,
    );
    r.resize(100, 100, 1);
    const g = sampleGraph(2);
    g.flags = new Uint8Array([NODE_HOLLOW, NODE_RING]);
    r.setGraph(g);
    r.setPositions(new Float32Array([0, 0, 20, 0]));
    calls.length = 0;
    r.draw();
    expect(count(calls, "fill")).toBe(1); // ring node body
    expect(count(calls, "stroke")).toBe(1 + 1 + 1); // edges + hollow + ring
  });

  it("skips the dense edge layer when zoomed out at huge edge counts", () => {
    const n = 4;
    const { ctx, calls } = recordingCtx();
    const r = new Canvas2DRenderer(
      fakeCanvas(() => ctx),
      ctx,
    );
    r.resize(100, 100, 1);
    const m = EDGE_SKIP_COUNT + 1;
    const edges = new Uint32Array(2 * m);
    for (let k = 0; k < m; k++) {
      edges[2 * k] = k % n;
      edges[2 * k + 1] = (k + 1) % n;
    }
    r.setGraph({ ...sampleGraph(n), edges });
    r.setPositions(new Float32Array(2 * n));
    r.setCamera({ x: 0, y: 0, scale: 0.05 });
    calls.length = 0;
    r.draw();
    expect(count(calls, "lineTo")).toBe(0);
    r.setCamera({ x: 0, y: 0, scale: 1 });
    calls.length = 0;
    r.draw();
    expect(count(calls, "lineTo")).toBeGreaterThan(0);
  });

  it("copies positions (the layout buffer is transient) and dispose releases the canvas", () => {
    const { r, calls, canvas } = make();
    const src = new Float32Array(10);
    r.setPositions(src);
    src.fill(1e6);
    calls.length = 0;
    r.draw();
    expect(
      calls
        .filter((c) => c[0] === "arc")
        .every((c) => Math.abs(c[1] as number) < 1000),
    ).toBe(true);
    r.dispose();
    expect(canvas.remove).toHaveBeenCalled();
  });
});
