import { describe, expect, it } from "vitest";

import { fakeCanvas, fakeGl, sampleGraph } from "./fakes";
import { WebGL2Renderer } from "./webgl2";

const theme = {
  background: "#fff",
  edge: "#888",
  edgeHighlight: "#00f",
  label: "#000",
  accent: "#f80",
};

function make(n = 5) {
  const f = fakeGl();
  const canvas = fakeCanvas(() => f.gl);
  const r = new WebGL2Renderer(canvas, f.gl);
  r.resize(800, 600, 2);
  r.setTheme(theme);
  r.setGraph(sampleGraph(n));
  return { r, canvas, ...f };
}

describe("WebGL2Renderer (fake gl)", () => {
  it("reports renderer info and is webgl2", () => {
    const { r } = make();
    expect(r.kind).toBe("webgl2");
    expect(r.rendererInfo).toBe("Apple GPU");
  });

  it("camera-only draws are O(1): two instanced draws, no texture/buffer uploads", () => {
    const { r, calls, reset } = make();
    r.setPositions(new Float32Array(10));
    r.draw(); // first draw uploads the state texture once
    reset();
    for (let i = 0; i < 20; i++) {
      r.setCamera({ x: i, y: -i, scale: 1 + i / 10 });
      r.draw();
    }
    expect(calls.drawArraysInstanced).toHaveLength(40);
    expect(calls.texSubImage2D).toBeUndefined();
    expect(calls.bufferData).toBeUndefined();
    expect(calls.bufferSubData).toBeUndefined();
    expect(calls.createBuffer).toBeUndefined();
    expect(calls.uniform3f).toHaveLength(40);
  });

  it("uploads positions in whole rows plus a remainder row", () => {
    const n = 1024 * 2 + 5;
    const { r, calls, reset } = make(n);
    reset();
    r.setPositions(new Float32Array(2 * n));
    expect(calls.texSubImage2D).toHaveLength(2);
    const [full, rem] = calls.texSubImage2D;
    expect(full.slice(2, 6)).toEqual([0, 0, 1024, 2]); // x, y, w, h
    expect(rem.slice(2, 6)).toEqual([0, 2, 5, 1]);
    expect(rem[9]).toBe(2 * 1024 * 2); // srcOffset in elements
    reset();
    r.setPositions(new Float32Array(2 * n));
    expect(calls.texSubImage2D).toHaveLength(2); // one bufferSubData-equivalent per tick
  });

  it("mask / highlight upload the state texture once per draw, fade is uniform only", () => {
    const { r, calls, reset } = make();
    r.draw();
    reset();
    const nb = new Uint8Array([1, 1, 0, 0, 0]);
    r.setMask(new Uint8Array([0, 0, 0, 0, 1]));
    r.setHighlight({ hovered: 0, neighbours: nb, dimAlpha: 0.12 });
    r.draw();
    expect(calls.texSubImage2D).toHaveLength(1);
    reset();
    for (const a of [0.9, 0.5, 0.12]) {
      r.setHighlight({ hovered: 0, neighbours: nb, dimAlpha: a });
      r.draw();
    }
    expect(calls.texSubImage2D).toBeUndefined();
    r.setHighlight({
      hovered: 1,
      neighbours: new Uint8Array(5),
      dimAlpha: 0.12,
    });
    r.draw();
    expect(calls.texSubImage2D).toHaveLength(1);
  });

  it("caps DPR at 1.5 above 20k nodes", () => {
    const small = make(100);
    expect(small.canvas.width).toBe(1600);
    const big = make(20_001);
    expect(big.canvas.width).toBe(1200);
    expect(big.canvas.height).toBe(900);
    big.r.resize(400, 300, 1);
    expect(big.canvas.width).toBe(400);
  });

  it("dispose frees GL resources, loses the context and ignores later draws", () => {
    const { r, calls, lose, reset, canvas } = make();
    canvas.width = 640;
    canvas.height = 480;
    r.dispose();
    expect(lose.loseContext).toHaveBeenCalledTimes(1);
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
    expect(calls.deleteProgram).toHaveLength(2);
    expect(calls.deleteTexture.length).toBeGreaterThanOrEqual(2);
    expect(canvas.remove).toHaveBeenCalled();
    reset();
    r.draw();
    expect(calls.drawArraysInstanced).toBeUndefined();
    r.dispose(); // idempotent
    expect(lose.loseContext).toHaveBeenCalledTimes(1);
  });

  it("stops drawing after a lost context", () => {
    const { r, calls, reset, canvas } = make();
    canvas.listeners.webglcontextlost({ preventDefault() {} } as Event);
    reset();
    r.draw();
    r.setPositions(new Float32Array(10));
    expect(Object.keys(calls)).toHaveLength(0);
  });
});
