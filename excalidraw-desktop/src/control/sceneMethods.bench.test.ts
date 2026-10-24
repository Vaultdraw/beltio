import { describe, expect, it } from "vitest";

import { makeElements } from "../sceneOps/testUtils";

import { createSceneMethods } from "./sceneMethods";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { ActiveScene } from "../sceneOps/sceneBus";

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

const adds = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    op: "add",
    element:
      i % 4 === 3
        ? { type: "text", text: `note ${i}` }
        : {
            type: "rectangle",
            width: 80,
            height: 40,
            backgroundColor: "#ffec99",
          },
  }));

describe("scene.apply micro-benchmark (jsdom, fake editor)", () => {
  const apply100 = (size: number) => {
    const base = makeElements(size);
    let els: ExcalidrawElement[] = base;
    const scene = {
      api: {
        getAppState: () => ({
          scrollX: 0,
          scrollY: 0,
          width: 1000,
          height: 600,
          zoom: { value: 1 },
          selectedElementIds: {},
        }),
        getSceneElementsIncludingDeleted: () => els,
        // Like the editor: the written array becomes the scene; reset below so runs match.
        updateScene: (s: { elements: ExcalidrawElement[] }) => {
          els = s.elements;
        },
      },
      path: "bench.excalidraw",
      readOnly: false,
    } as unknown as ActiveScene;
    const m = createSceneMethods({ active: () => scene, notify: () => {} });
    const ops = adds(100);
    const r = measure(() => {
      els = base;
      m["scene.apply"]({ ops });
    }, 30);
    console.info(
      `scene.apply 100 adds (${size} scene, fake editor): p50 ${r.p50.toFixed(
        3,
      )} ms, p95 ${r.p95.toFixed(3)} ms`,
    );
    return r;
  };

  it("100 adds into an empty scene", () => {
    expect(apply100(0).p95).toBeLessThan(150);
  });

  it("100 adds into a 10k scene (includes the version hash of the new array)", () => {
    expect(apply100(10_000).p95).toBeLessThan(150);
  });
});
