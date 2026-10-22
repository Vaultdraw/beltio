import { getSceneVersion } from "@excalidraw/element";
import { describe, expect, it } from "vitest";

import { applyOps } from "./apply";
import { buildElements } from "./build";
import { projectScene } from "./project";
import { byId, makeElements, stubApi } from "./testUtils";
import { validateOps } from "./validate";

import type { NewElement, SceneOp } from "./types";

/** p50/p95 in ms of `runs` calls (after a short warm-up). */
const measure = (fn: () => void, runs: number) => {
  for (let i = 0; i < 3; i++) {
    fn();
  }
  const t: number[] = [];
  for (let i = 0; i < runs; i++) {
    const s = performance.now();
    fn();
    t.push(performance.now() - s);
  }
  t.sort((a, b) => a - b);
  return {
    p50: t[Math.floor(t.length * 0.5)],
    p95: t[Math.floor(t.length * 0.95)],
  };
};
const report = (name: string, r: { p50: number; p95: number }) =>
  console.info(
    `${name}: p50 ${r.p50.toFixed(3)} ms, p95 ${r.p95.toFixed(3)} ms`,
  );

const adds = (n: number): NewElement[] =>
  Array.from({ length: n }, (_, i) =>
    i % 4 === 3
      ? { type: "text", text: `note ${i}` }
      : {
          type: "rectangle",
          width: 80,
          height: 40,
          backgroundColor: "#ffec99",
        },
  );

describe("sceneOps micro-benchmark (jsdom)", () => {
  const els = makeElements(10_000);

  it("projection at 10k elements", () => {
    // Cold: a fresh array identity each run.
    const cold = measure(() => projectScene([...els]), 30);
    report("projectScene cold (10k)", cold);
    const cached = measure(() => projectScene(els), 200);
    report("projectScene cached (10k, includes getSceneVersion)", cached);
    report(
      "getSceneVersion (10k)",
      measure(() => getSceneVersion(els), 200),
    );
    expect(cold.p95).toBeLessThan(3);
    expect(cached.p95).toBeLessThan(0.5);
  });

  it("validateOps, 100 ops against 10k elements", () => {
    const map = byId(els);
    const ops: SceneOp[] = [
      ...adds(60).map((element) => ({ op: "add" as const, element })),
      ...els.slice(0, 20).map((e) => ({
        op: "update" as const,
        id: e.id,
        props: { x: 1, strokeColor: "red" },
      })),
      ...els.slice(20, 40).map((e) => ({ op: "delete" as const, id: e.id })),
    ];
    const r = measure(() => validateOps(ops, map), 100);
    report("validateOps x100", r);
    expect(r.p95).toBeLessThan(5);
  });

  it("buildElements, 100 adds", () => {
    const batch = adds(100);
    const r = measure(() => buildElements(batch, { x: 0, y: 0 }), 30);
    report("buildElements x100", r);
    expect(r.p95).toBeLessThan(100);
  });

  it("applyOps, 100 adds against a 10k stub api", () => {
    const { api } = stubApi(els);
    const ops = adds(100).map((element) => ({ op: "add" as const, element }));
    const r = measure(() => applyOps(api, ops), 20);
    report("applyOps 100 adds (10k scene, stub api)", r);
    expect(r.p95).toBeLessThan(150);
  });
});
