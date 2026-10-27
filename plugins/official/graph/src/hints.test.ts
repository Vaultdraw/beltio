import { describe, expect, it } from "vitest";

import {
  assignNodeHints,
  hintCapacity,
  resolveHint,
  visibleHintNodes,
} from "./hints";

const view = (
  pos: number[],
  degree: number[],
  mask: Uint8Array | null = null,
) => ({
  positions: Float32Array.from(pos),
  n: pos.length / 2,
  camera: { x: 0, y: 0, scale: 1 },
  width: 200,
  height: 100,
  mask,
  degree: (i: number) => degree[i],
});

describe("visibleHintNodes", () => {
  it("keeps on-screen unmasked nodes, busiest first", () => {
    // screen = world + (100, 50)
    const v = view(
      [0, 0, 500, 0, 10, 10, -90, 0],
      [1, 9, 5, 2],
      Uint8Array.from([0, 0, 0, 1]),
    );
    expect(visibleHintNodes(v)).toEqual([2, 0]);
  });

  it("caps the count and breaks ties by id", () => {
    const v = view([0, 0, 1, 1, 2, 2, 3, 3], [4, 4, 4, 4]);
    expect(visibleHintNodes(v, 3)).toEqual([0, 1, 2]);
  });
});

describe("assignNodeHints", () => {
  it("gives short unique labels from the hint characters", () => {
    const h = assignNodeHints([7, 8, 9], "asdf");
    expect([...h.labels.values()]).toEqual(["a", "s", "d"]);
    expect(h.nodes.get("s")).toBe(8);
  });

  it("uses two letters for more nodes and never more than chars squared", () => {
    expect(hintCapacity("asdfghjkl")).toBe(81);
    const ids = Array.from({ length: 200 }, (_, i) => i);
    const h = assignNodeHints(ids, "asdfghjkl");
    expect(h.labels.size).toBe(81);
    expect(new Set(h.labels.values()).size).toBe(81);
    expect([...h.labels.values()].every((l) => l.length === 2)).toBe(true);
  });
});

describe("resolveHint", () => {
  const h = assignNodeHints(
    Array.from({ length: 20 }, (_, i) => i),
    "asdfg",
  );
  it("matches a full label, accepts a prefix, rejects the rest", () => {
    const label = h.labels.get(7)!;
    expect(resolveHint(h, label)).toEqual({ kind: "match", node: 7 });
    expect(resolveHint(h, label[0].toUpperCase() + label[1])).toEqual({
      kind: "match",
      node: 7,
    });
    expect(resolveHint(h, label[0])).toEqual({ kind: "partial" });
    expect(resolveHint(h, "zz")).toEqual({ kind: "none" });
  });
});
