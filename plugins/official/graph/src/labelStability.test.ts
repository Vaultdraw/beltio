import { describe, expect, it } from "vitest";

import { LabelLayer } from "./labels";

/** A seeded generator so the drift is the same on every run. */
const rng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};

const DT = 1000 / 60;

/** Records what `draw` paints: node text -> alpha for one frame. */
const recorder = () => {
  const frame = new Map<string, number>();
  const ctx = {
    setTransform() {},
    clearRect() {
      frame.clear();
    },
    fillText(t: string) {
      frame.set(t, ctx.globalAlpha);
    },
    font: "",
    fillStyle: "",
    textBaseline: "",
    globalAlpha: 1,
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, frame };
};

/** A dense cluster whose nodes drift like a settling force layout. */
const scene = (n: number) => {
  const r = rng(7);
  const home = new Float32Array(2 * n);
  for (let i = 0; i < 2 * n; i++) {
    home[i] = (r() - 0.5) * 420;
  }
  const deg = Array.from({ length: n }, (_, i) => 1 + ((i * 7) % 13));
  return { home, deg };
};

const run = (frames: number, drift: number, zoom = 1, settle = 0) => {
  const n = 160;
  const { home, deg } = scene(n);
  const L = new LabelLayer({ label: (i) => `n${i}`, fadeScale: 0.2 });
  L.setGraph(n, deg);
  const { ctx, frame } = recorder();
  const pos = new Float32Array(home);
  const prev = new Map<string, number>();
  const seen = new Map<string, { on: boolean; flips: number }>();
  for (let t = 0; t < frames; t++) {
    // `settle` > 0: the drift dies away like a cooling force layout.
    const amp = drift * Math.exp(-settle * t);
    for (let i = 0; i < n; i++) {
      pos[2 * i] = home[2 * i] + amp * Math.sin(t / 9 + i);
      pos[2 * i + 1] = home[2 * i + 1] + amp * Math.cos(t / 11 + i * 1.7);
    }
    L.draw(
      ctx,
      {
        positions: pos,
        camera: { x: 0, y: 0, scale: zoom },
        width: 800,
        height: 600,
        dtMs: DT,
      },
      "#000",
    );
    for (const text of new Set([...frame.keys(), ...prev.keys()])) {
      const on = frame.has(text);
      const s = seen.get(text) ?? { on: false, flips: 0 };
      if (s.on !== on) {
        s.flips++;
      }
      s.on = on;
      seen.set(text, s);
    }
    prev.clear();
    for (const [text, a] of frame) {
      prev.set(text, a);
    }
  }
  const flips = [...seen.values()].reduce((a, s) => a + s.flips, 0);
  return { L, flips, shown: frame.size };
};

describe("label stability at a fixed zoom", () => {
  it("a still graph settles: labels fade in once and the loop stops needing frames", () => {
    const { L, flips, shown } = run(60, 0);
    expect(shown).toBeGreaterThan(5);
    expect(L.animating).toBe(false);
    // every label turned on exactly once and never off
    expect(flips).toBe(shown);
  });

  it("a drifting graph never changes a label's opacity faster than the fade allows", () => {
    const { L } = run(240, 6);
    expect(L.worstStep).toBeGreaterThan(0);
    expect(L.worstStep).toBeLessThanOrEqual(1.001);
  });

  it("a settling layout turns each label on about once", () => {
    const { flips, shown, L } = run(300, 8, 1, 0.03);
    expect(flips).toBeLessThanOrEqual(shown * 2.5);
    expect(L.animating).toBe(false); // faded in, loop can stop
  });

  it("endless drift: labels still flip several times less often than before (about 1000 flips for 80 labels)", () => {
    // The old layout re-decided every collision each frame: 1019 on/off flips
    // for this scene (measured on the previous implementation). Now each flip is a slow fade.
    const { flips } = run(240, 6);
    expect(flips).toBeLessThanOrEqual(400);
  });
});
