import { describe, expect, it } from "vitest";

import { LayoutHost, type FromLayout } from "./layoutHost";
import { genGraph, initPositions } from "./testGraph";

function setup(tickMs: number) {
  const g = genGraph(200);
  let t = 0;
  const posts: FromLayout[] = [];
  const delays: number[] = [];
  let cancels = 0;
  const host = new LayoutHost(
    (m) => posts.push(m),
    (d) => delays.push(d),
    () => t,
    8,
    tickMs,
    () => cancels++,
  );
  host.handle({
    type: "init",
    n: g.n,
    edges: g.edges.slice(),
    positions: initPositions(g),
  });
  return {
    host,
    posts,
    delays,
    advance: (ms: number) => (t += ms),
    cancels: () => cancels,
  };
}

describe("LayoutHost pacing", () => {
  it("does one tick per run and asks for the rest of the frame", () => {
    const s = setup(16);
    expect(s.delays).toEqual([0]);
    s.host.run();
    expect(s.posts.filter((m) => m.type === "positions")).toHaveLength(1);
    const first = s.posts[0] as Extract<FromLayout, { type: "positions" }>;
    expect(first.tick).toBe(1);
    // fake clock does not advance during the tick: full delay
    expect(s.delays).toEqual([0, 16]);
    s.host.run();
    expect((s.posts[1] as { tick: number }).tick).toBe(2);
  });

  it("subtracts the tick duration and goes back-to-back when slower than tickMs", () => {
    const s = setup(16);
    // now() is called at start and after the tick; make each call advance 5 ms
    let t = 0;
    const host = new LayoutHost(
      () => {},
      (d) => s.delays.push(d),
      () => (t += 5),
      8,
      16,
    );
    const g = genGraph(50);
    host.handle({
      type: "init",
      n: g.n,
      edges: g.edges.slice(),
      positions: initPositions(g),
    });
    s.delays.length = 0;
    host.run();
    expect(s.delays).toEqual([11]);
    t = 0;
    const slow = new LayoutHost(
      () => {},
      (d) => s.delays.push(d),
      () => (t += 40),
      8,
      16,
    );
    slow.handle({
      type: "init",
      n: g.n,
      edges: g.edges.slice(),
      positions: initPositions(g),
    });
    s.delays.length = 0;
    slow.run();
    expect(s.delays).toEqual([0]);
  });

  it("tickMs 0 ticks for the whole slice and reschedules immediately", () => {
    const s = setup(0);
    let calls = 0;
    const g = genGraph(50);
    let t = 0;
    const delays: number[] = [];
    const host = new LayoutHost(
      () => {},
      (d) => delays.push(d),
      () => {
        calls++;
        return (t += 1);
      },
      8,
      0,
    );
    host.handle({
      type: "init",
      n: g.n,
      edges: g.edges.slice(),
      positions: initPositions(g),
    });
    host.run();
    expect(calls).toBeGreaterThan(4);
    expect(delays).toEqual([0, 0]);
    expect(s.delays).toEqual([0]);
  });

  it("init can carry tickMs", () => {
    const s = setup(0);
    const g = genGraph(50);
    s.host.handle({
      type: "init",
      n: g.n,
      edges: g.edges.slice(),
      positions: initPositions(g),
      tickMs: 10,
    });
    s.delays.length = 0;
    s.host.run();
    expect(s.delays).toEqual([10]);
  });

  it("does not double-schedule while a run is pending, and stop cancels", () => {
    const s = setup(16);
    s.host.run();
    expect(s.delays).toEqual([0, 16]);
    s.host.handle({ type: "drag", node: 1, x: 5, y: 5 });
    s.host.handle({ type: "settings", settings: { repel: 12 } });
    s.host.handle({ type: "release" });
    expect(s.delays).toEqual([0, 16]);
    s.host.handle({ type: "stop" });
    expect(s.cancels()).toBe(1);
    const n = s.posts.length;
    s.host.run();
    expect(s.posts).toHaveLength(n);
    expect(s.host.active).toBe(false);
  });

  it("settles with a final post and no further schedule", () => {
    const s = setup(16);
    for (let i = 0; i < 5000 && s.host.active; i++) {
      s.host.run();
    }
    expect(s.host.active).toBe(false);
    const last = s.posts[s.posts.length - 1];
    expect(last.type).toBe("settled");
    expect(s.posts[s.posts.length - 2].type).toBe("positions");
    const scheduled = s.delays.length;
    s.host.run();
    expect(s.delays).toHaveLength(scheduled);
  });
});
