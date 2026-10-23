import { describe, expect, it } from "vitest";

import { linkAt } from "./linkBoxes";

import type { VersionedText } from "./linkBoxes";

let measureCalls = 0;
const measure = (t: string) => {
  measureCalls++;
  return t.length * 10;
};

describe("link box hit test performance", () => {
  it("500 linked texts + 2000 other elements: no measuring on cache hits, one visit per element", () => {
    const elements: VersionedText[] = [];
    for (let i = 0; i < 2000; i++) {
      elements.push({
        id: `r${i}`,
        type: "rectangle",
        x: (i % 50) * 100,
        y: Math.floor(i / 50) * 100,
        width: 80,
        height: 80,
        angle: 0,
        text: "",
        fontSize: 20,
        fontFamily: 1,
        lineHeight: 1.25,
        textAlign: "left",
      });
    }
    for (let i = 0; i < 500; i++) {
      elements.push({
        id: `t${i}`,
        type: "text",
        x: (i % 25) * 200,
        y: Math.floor(i / 25) * 60,
        width: 180,
        height: 25,
        angle: i % 7 === 0 ? 0.3 : 0,
        fontSize: 20,
        fontFamily: 1,
        lineHeight: 1.25,
        textAlign: "left",
        text: `see [[Note ${i}]] ok`,
        version: 1,
      });
    }
    // Count work, not milliseconds (wall-clock budgets live in the perf
    // harness): `text` reads per scan and `measure` calls.
    let textReads = 0;
    const counted = elements.map(
      (el) =>
        new Proxy(el, {
          get(target, prop, receiver) {
            if (prop === "text") {
              textReads++;
            }
            return Reflect.get(target, prop, receiver);
          },
        }),
    );
    // Warm the cache the way the first hovers would: every linked text is
    // measured once.
    measureCalls = 0;
    for (let i = 0; i < 500; i++) {
      expect(
        linkAt(
          counted,
          { x: (i % 25) * 200 + 60, y: Math.floor(i / 25) * 60 + 10 },
          measure,
        ),
      ).not.toBeNull();
    }
    expect(measureCalls).toBeGreaterThan(0);
    const warmCalls = measureCalls;

    // Hits on warm elements: no measuring, and no element scanned twice.
    const times: number[] = [];
    measureCalls = 0;
    for (let run = 0; run < 1000; run++) {
      const i = (run * 37) % 500;
      const pt = {
        x: (i % 25) * 200 + 60 + (run % 5),
        y: Math.floor(i / 25) * 60 + 10,
      };
      textReads = 0;
      const s = performance.now();
      linkAt(counted, pt, measure);
      times.push(performance.now() - s);
      expect(textReads).toBeLessThanOrEqual(counted.length);
    }
    expect(measureCalls).toBe(0);

    // Pointer over empty canvas: the whole scene is scanned, nothing hits,
    // nothing is measured, each element is read at most once.
    const misses: number[] = [];
    for (let run = 0; run < 1000; run++) {
      textReads = 0;
      const s = performance.now();
      const hit = linkAt(counted, { x: -500 - run, y: -500 }, measure);
      misses.push(performance.now() - s);
      expect(hit).toBeNull();
      expect(textReads).toBeLessThanOrEqual(counted.length);
    }
    expect(measureCalls).toBe(0);
    // Measuring is per element (a few calls each), once: never per frame.
    expect(warmCalls).toBeLessThanOrEqual(500 * 4);

    misses.sort((a, b) => a - b);
    // eslint-disable-next-line no-console
    console.info(
      `link box hit test, full-scene miss: p95 ${misses[949].toFixed(4)} ms`,
    );
    times.sort((a, b) => a - b);
    const p = (q: number) => times[Math.floor(q * (times.length - 1))];
    // eslint-disable-next-line no-console
    console.info(
      `link box hit test 500 linked + 2000 other: p50 ${p(0.5).toFixed(
        4,
      )} ms, p95 ${p(0.95).toFixed(4)} ms, max ${times[
        times.length - 1
      ].toFixed(4)} ms`,
    );
  });
});
