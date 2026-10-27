import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import fixture from "../../../../excalidraw-desktop/src-tauri/src/links/fixtures/graph_small.json";

import { decodeGraph, GraphDecodeError } from "./decode";
import { fakeGraph } from "./fakeGraph";
import { FLAG_ORPHAN, FLAG_TAG, FLAG_UNRESOLVED } from "./types";

const bin = readFileSync(
  resolve(
    __dirname,
    "../../../../excalidraw-desktop/src-tauri/src/links/fixtures/graph_small.bin",
  ),
);

describe("decodeGraph (Rust fixture)", () => {
  const g = decodeGraph(new Uint8Array(bin));

  it("matches the golden description", () => {
    expect(g.nodeCount).toBe(fixture.nodeCount);
    expect(g.edgeCount).toBe(fixture.edgeCount);
    expect(g.folderCount).toBe(fixture.folders.length);
    fixture.folders.forEach((name, f) => expect(g.folderName(f)).toBe(name));
    fixture.nodes.forEach((n, i) => {
      expect(g.label(i)).toBe(n.label);
      expect(g.folder[i]).toBe(n.folder);
      expect(g.flags[i]).toBe(n.flags);
      expect(g.outDeg[i]).toBe(n.out);
      expect(g.inDeg[i]).toBe(n.in);
    });
    expect(Array.from(g.edges)).toEqual(fixture.edges.flat());
  });

  it("derives paths, kinds and flags", () => {
    expect(g.path(0)).toBe("A/x.excalidraw");
    expect(g.isDrawing(0)).toBe(true);
    expect(g.path(5)).toBeNull();
    expect(g.flags[5]).toBe(FLAG_UNRESOLVED);
    expect(g.flags[6]).toBe(FLAG_TAG);
    expect(g.label(6)).toBe("#t1");
    expect(g.flags[2]).toBe(FLAG_ORPHAN);
    expect(g.isDrawing(6)).toBe(false);
  });

  it("builds undirected adjacency lazily", () => {
    // x(0): y, ghost, t1, t2 out; y in
    expect(Array.from(g.neighbours(0)).sort()).toEqual([1, 1, 5, 6, 7]);
    expect(Array.from(g.neighbours(4))).toEqual([1]);
    expect(g.neighbours(2).length).toBe(1);
    const a = g.adjacency();
    expect(a.offsets[a.offsets.length - 1]).toBe(2 * g.edgeCount);
  });

  it("decodes from an offset view and rejects bad input", () => {
    const padded = new Uint8Array(bin.length + 3);
    padded.set(bin, 3);
    const g2 = decodeGraph(padded.subarray(3));
    expect(g2.label(1)).toBe("A/y");
    expect(() => decodeGraph(new Uint8Array(4))).toThrow(GraphDecodeError);
    const bad = new Uint8Array(bin);
    bad[0] = 0;
    expect(() => decodeGraph(bad)).toThrow(GraphDecodeError);
    expect(() => decodeGraph(new Uint8Array(bin).subarray(0, 40))).toThrow(
      GraphDecodeError,
    );
  });
});

describe("fakeGraph", () => {
  it("is deterministic and structurally valid", () => {
    const a = fakeGraph(1000);
    const b = fakeGraph(1000);
    expect(Array.from(a.edges)).toEqual(Array.from(b.edges));
    const n = a.nodeCount;
    expect(a.edges.every((x) => x < n)).toBe(true);
    for (let k = 0; k < a.edges.length; k += 2) {
      expect(a.edges[k]).not.toBe(a.edges[k + 1]);
    }
    expect(a.outDeg.reduce((s, x) => s + x, 0)).toBe(a.edgeCount);
    expect(a.inDeg.reduce((s, x) => s + x, 0)).toBe(a.edgeCount);
    expect(a.flags.some((f) => f & FLAG_UNRESOLVED)).toBe(true);
    expect(a.flags.some((f) => f & FLAG_TAG)).toBe(true);
    expect(a.flags.some((f) => f & FLAG_ORPHAN)).toBe(true);
    expect(a.folderName(0)).toBe("");
  });
});
