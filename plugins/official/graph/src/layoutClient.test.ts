import { afterEach, describe, expect, it } from "vitest";

import { LayoutClient } from "./layoutClient";
import { genGraph, initPositions } from "./testGraph";

const live: LayoutClient[] = [];
afterEach(() => {
  live.forEach((c) => c.terminate());
  live.length = 0;
});

function make() {
  const g = genGraph(300);
  const got = {
    calls: 0,
    settled: 0,
    last: null as Float32Array | null,
    tick: 0,
  };
  const client = new LayoutClient(
    {
      onPositions: (p, info) => {
        got.calls++;
        got.last = p;
        got.tick = info.tick;
      },
      onSettled: () => got.settled++,
    },
    true,
  );
  live.push(client);
  return { g, got, client };
}

describe("LayoutClient (in-thread)", () => {
  it("runs to settle, posts finite positions and settles once", () => {
    const { g, got, client } = make();
    client.start({
      nodeCount: g.n,
      edges: g.edges.slice(),
      positions: initPositions(g),
    });
    expect(client.runSync()).toBe(true);
    expect(got.settled).toBe(1);
    expect(got.last).toHaveLength(2 * g.n);
    expect(got.last!.every(Number.isFinite)).toBe(true);
    expect(got.tick).toBeGreaterThan(10);
  });

  it("does no work after settle, and wakes on settings, drag and mask", async () => {
    const { g, got, client } = make();
    client.start({
      nodeCount: g.n,
      edges: g.edges.slice(),
      positions: initPositions(g),
    });
    client.runSync();
    const calls = got.calls;
    await new Promise((r) => setTimeout(r, 30));
    expect(got.calls).toBe(calls);

    client.setSettings({ repel: 14 });
    expect(client.runSync()).toBe(true);
    expect(got.calls).toBeGreaterThan(calls);
    expect(got.settled).toBe(2);

    client.drag(5, 100, 100);
    client.runSync(20);
    expect(got.last![10]).toBe(100);
    client.release();
    expect(client.runSync()).toBe(true);
    expect(got.settled).toBe(3);

    const mask = new Uint8Array(g.n);
    mask[7] = 1;
    client.setMask(mask);
    expect(client.runSync()).toBe(true);
    expect(got.settled).toBe(4);
  });

  it("terminate stops everything and is idempotent", async () => {
    const { g, got, client } = make();
    client.start({
      nodeCount: g.n,
      edges: g.edges.slice(),
      positions: initPositions(g),
    });
    client.terminate();
    client.terminate();
    await new Promise((r) => setTimeout(r, 30));
    expect(got.calls).toBe(0);
  });
});
