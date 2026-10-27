import { describe, expect, it } from "vitest";

import { skeletonsToOps } from "./mermaidOps";

const flow = [
  {
    id: "A",
    type: "rectangle",
    x: 100,
    y: 50,
    width: 80,
    height: 40,
    label: { text: "Idea", fontSize: 20 },
    strokeColor: "#1e1e1e",
  },
  { id: "B", type: "ellipse", x: 300, y: 50, width: 80, height: 40 },
  {
    type: "arrow",
    x: 180,
    y: 70,
    points: [
      [0, 0],
      [120, 0],
    ],
    start: { id: "A" },
    end: { id: "B" },
    label: { text: "go" },
  },
  { type: "text", x: 100, y: 10, text: "Title", fontSize: 24 },
  { type: "image", x: 0, y: 0 },
];

describe("skeletonsToOps (Mermaid result as plugin scene ops)", () => {
  it("puts the top left at 0, 0 and measures the diagram", () => {
    const r = skeletonsToOps(flow as never);
    expect(r.width).toBe(280);
    expect(r.height).toBe(80);
    const a = r.ops.find((o) => o.op === "add" && o.ref === "A") as any;
    expect([a.element.x, a.element.y]).toEqual([0, 40]);
  });

  it("keeps labels, binds straight arrows to their shapes and skips pictures", () => {
    const r = skeletonsToOps(flow as never);
    expect(r.skipped).toBe(1);
    const a = r.ops.find((o) => o.op === "add" && o.ref === "A") as any;
    expect(a.element).toMatchObject({ text: "Idea", fontSize: 20 });
    const arrow = r.ops.find(
      (o) => o.op === "add" && o.element.type === "arrow",
    ) as any;
    expect(arrow.element).toMatchObject({
      start: { ref: "A" },
      end: { ref: "B" },
      text: "go",
    });
    // Shapes come before the arrows that bind to them.
    expect(r.ops.indexOf(a)).toBeLessThan(r.ops.indexOf(arrow));
  });

  it("does not bind a bent arrow, and an empty result has no size", () => {
    const bent = skeletonsToOps([
      { id: "A", type: "rectangle", x: 0, y: 0 },
      { id: "B", type: "rectangle", x: 0, y: 200 },
      {
        type: "arrow",
        x: 0,
        y: 0,
        points: [
          [0, 0],
          [50, 0],
          [50, 200],
        ],
        start: { id: "A" },
        end: { id: "B" },
      },
    ] as never);
    const arrow = bent.ops.find(
      (o) => o.op === "add" && o.element.type === "arrow",
    ) as any;
    expect(arrow.element.start).toBeUndefined();
    expect(arrow.element.points).toHaveLength(3);
    expect(skeletonsToOps([])).toEqual({
      ops: [],
      width: 0,
      height: 0,
      skipped: 0,
    });
  });
});
