import { describe, expect, it } from "vitest";

import { chooseBackend } from "./pick";
import {
  edgeAlpha,
  effectiveDpr,
  isSoftwareRenderer,
  nodeZoomFactor,
  packRgba,
  parseColour,
} from "./shared";

describe("renderer shared helpers", () => {
  it("caps DPR at 1.5 above 20k nodes only", () => {
    expect(effectiveDpr(2, 20_000)).toBe(2);
    expect(effectiveDpr(2, 20_001)).toBe(1.5);
    expect(effectiveDpr(1, 50_000)).toBe(1);
    expect(effectiveDpr(0, 10)).toBe(1);
  });

  it("parses theme colours", () => {
    expect(parseColour("#fff")).toEqual([1, 1, 1, 1]);
    expect(parseColour("#ff000080")[3]).toBeCloseTo(0.5, 2);
    expect(parseColour("rgb(255, 0, 51)")).toEqual([1, 0, 0.2, 1]);
    expect(parseColour("rgba(0 0 0 / 0.5)")).toEqual([0, 0, 0, 0.5]);
    expect(parseColour("nonsense")).toEqual([1, 0, 1, 1]);
  });

  it("packs RGBA little-endian", () => {
    expect(packRgba(1, 2, 3, 4)).toBe(0x04030201);
    expect(
      new Uint8Array(new Uint32Array([packRgba(9, 8, 7, 255)]).buffer)[0],
    ).toBe(9);
  });

  it("edge alpha grows with zoom, shrinks with edge count, stays in range", () => {
    expect(edgeAlpha(1, 1000)).toBeGreaterThan(edgeAlpha(0.05, 1000));
    expect(edgeAlpha(1, 75000)).toBeLessThan(edgeAlpha(1, 1000));
    for (const s of [0, 0.01, 1, 8]) {
      const a = edgeAlpha(s, 75000);
      expect(a).toBeGreaterThanOrEqual(0.1);
      expect(a).toBeLessThanOrEqual(0.85);
    }
    expect(nodeZoomFactor(0)).toBe(0.6);
    expect(nodeZoomFactor(100)).toBe(2.5);
  });

  it("detects software renderers", () => {
    expect(
      isSoftwareRenderer(
        "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0)), SwiftShader driver)",
      ),
    ).toBe(true);
    expect(isSoftwareRenderer("llvmpipe (LLVM 15.0.7, 256 bits)")).toBe(true);
    expect(isSoftwareRenderer("Microsoft Basic Render Driver Software")).toBe(
      true,
    );
    expect(
      isSoftwareRenderer("ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Pro)"),
    ).toBe(false);
    expect(isSoftwareRenderer("Apple GPU")).toBe(false);
  });

  it("chooseBackend", () => {
    expect(chooseBackend("Apple GPU")).toEqual({ backend: "webgl2" });
    expect(chooseBackend("Apple GPU", true)).toEqual({
      backend: "canvas2d",
      reason: "forced",
    });
    expect(chooseBackend(null)).toEqual({
      backend: "canvas2d",
      reason: "no-webgl2",
    });
    expect(chooseBackend("SwiftShader driver")).toEqual({
      backend: "canvas2d",
      reason: "software",
    });
  });
});
