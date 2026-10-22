import { describe, expect, it } from "vitest";

import { getCommonBounds } from "@excalidraw/element";

import { buildElements } from "./build";

const mid = (els: Parameters<typeof getCommonBounds>[0]) => {
  const [a, b, c, d] = getCommonBounds(els);
  return { x: (a + c) / 2, y: (b + d) / 2 };
};

describe("buildElements", () => {
  it("returns [] for no adds", () => {
    expect(buildElements([], { x: 0, y: 0 })).toEqual([]);
  });

  it("centres an unplaced batch and keeps relative offsets", () => {
    const out = buildElements(
      [
        { type: "rectangle", width: 100, height: 50 },
        { type: "ellipse", width: 40, height: 40 },
      ],
      { x: 500, y: 300 },
    );
    expect(out).toHaveLength(2);
    expect(mid(out)).toEqual({ x: 500, y: 300 });
    expect(out[0].x).toBe(out[1].x); // both started at the same origin
  });

  it("keeps explicit coordinates absolute", () => {
    const out = buildElements(
      [{ type: "rectangle", x: 10, y: 20, width: 5, height: 5 }],
      { x: 500, y: 300 },
    );
    expect([out[0].x, out[0].y]).toEqual([10, 20]);
  });

  it("gives fresh unique ids and measures text", () => {
    const out = buildElements(
      [
        { type: "text", text: "hello" },
        { type: "text", text: "world" },
      ],
      { x: 0, y: 0 },
    );
    expect(new Set(out.map((e) => e.id)).size).toBe(2);
    expect(out[0].width).toBeGreaterThan(0);
  });

  it("builds arrows from points and labels as bound text", () => {
    const out = buildElements(
      [
        {
          type: "arrow",
          points: [
            [0, 0],
            [100, 50],
          ],
        },
        { type: "rectangle", width: 80, height: 40, text: "box" },
      ],
      { x: 0, y: 0 },
    );
    expect(out.map((e) => e.type)).toEqual(["arrow", "rectangle", "text"]);
    expect(out[0].width).toBe(100);
  });
});
