import { describe, expect, it } from "vitest";

import { passStats } from "./refreshRateStats";

import type { FrameSample } from "./refreshRateStats";

/** `n` frames `step` ms apart; `renders(i)` / `inputs(i)` per frame. */
const frames = (
  n: number,
  step: number | ((i: number) => number),
  renders: (i: number) => number = () => 1,
  inputs: (i: number) => number = () => 1,
): FrameSample[] => {
  const out: FrameSample[] = [];
  let t = 1000;
  for (let i = 0; i < n; i++) {
    out.push({ t, renders: renders(i), inputs: inputs(i) });
    t += typeof step === "number" ? step : step(i);
  }
  return out;
};

describe("passStats", () => {
  it("a steady 120 Hz pass with one render per frame", () => {
    const s = passStats(frames(121, 1000 / 120), 120);
    expect(s.fps).toBe(120);
    expect(s.renderHz).toBe(120);
    expect(s.framesLe9msPct).toBe(100);
    expect(s.vsyncBuckets.one).toBe(100);
    expect(s.droppedFrames).toBe(0);
    expect(s.multiRenderFrames).toBe(0);
  });

  it("rAF at 120 Hz but the scene drawn every other frame shows 60 Hz", () => {
    const s = passStats(
      frames(121, 1000 / 120, (i) => (i % 2 ? 2 : 0)),
      120,
    );
    expect(s.fps).toBe(120);
    expect(s.renderHz).toBe(60);
    expect(s.rendersPerSec).toBe(120);
    expect(s.multiRenderFrames).toBe(60);
    expect(s.inputWithoutRenderFrames).toBe(60);
  });

  it("input bunched two per frame then none: inputFrameHz caps renderHz", () => {
    const s = passStats(
      frames(
        121,
        1000 / 120,
        (i) => (i % 2 ? 1 : 0),
        (i) => (i % 2 ? 2 : 0),
      ),
      120,
    );
    expect(s.inputHz).toBe(120);
    expect(s.inputFrameHz).toBe(60);
    expect(s.renderHz).toBe(60);
  });

  it("a 60 fps cap on a 120 Hz screen: every interval misses one vsync", () => {
    const s = passStats(frames(61, 1000 / 60), 120);
    expect(s.fps).toBe(60);
    expect(s.framesLe9msPct).toBe(0);
    expect(s.vsyncBuckets.two).toBe(100);
    expect(s.droppedFrames).toBe(60);
  });

  it("long frames land in the 3 and 4+ vsync buckets", () => {
    const s = passStats(
      frames(5, (i) => [1000 / 120, 25, 50, 1000 / 120][i] ?? 8),
      120,
    );
    expect(s.vsyncBuckets).toEqual({
      one: 50,
      two: 0,
      three: 25,
      fourPlus: 25,
    });
    expect(s.droppedFrames).toBe(2 + 5);
  });

  it("ignores the counters of the first sample (time before the pass)", () => {
    const s = passStats(
      frames(
        3,
        10,
        (i) => (i === 0 ? 50 : 0),
        (i) => (i === 0 ? 50 : 0),
      ),
      120,
    );
    expect(s.rendersPerSec).toBe(0);
    expect(s.inputHz).toBe(0);
  });

  it("script time per rendering frame and busy share", () => {
    const samples = frames(11, 10).map((s, i) => ({
      ...s,
      scriptMs: i % 2 ? 4 : 2,
    }));
    const s = passStats(samples, 120);
    expect(s.scriptMsP50).toBe(3);
    expect(s.scriptMsP95).toBe(4);
    // 5 x 4 + 5 x 2 over 100 ms
    expect(s.scriptBusyPct).toBe(30);
  });

  it("empty input", () => {
    const s = passStats([], 120);
    expect(s.fps).toBe(0);
    expect(s.frames).toBe(0);
  });
});
