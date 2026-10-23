import { describe, expect, it } from "vitest";

import { hitTestTextLink } from "./textLinkHitTest";

import type { TextLike } from "./textLinkHitTest";

/** A text element of `count` lines, each with a link. */
function bigElement(count = 500): TextLike {
  const lines = Array.from({ length: count }, (_, i) => {
    // Same length on every line, whatever `count` is, so costs compare.
    const n = String(i).padStart(4, "0");
    return `line ${n} with a [[Graphs/Note ${n}|label ${n}]] and some more words`;
  });
  const width = Math.max(...lines.map((l) => l.length)) * 10;
  return {
    id: "big",
    type: "text",
    x: 0,
    y: 0,
    width,
    height: lines.length * 25,
    angle: 0,
    fontSize: 20,
    fontFamily: 1,
    lineHeight: 1.25,
    textAlign: "center",
    text: lines.join("\n"),
  };
}

/** A measure that counts its calls. */
function countingMeasure() {
  const counter = { calls: 0 };
  const measure = (t: string) => {
    counter.calls++;
    return t.length * 10;
  };
  return { counter, measure };
}

function scene(lines: number, plain: number): TextLike[] {
  const el = bigElement(lines);
  const others = Array.from({ length: plain }, (_, i) => ({
    ...el,
    id: `o${i}`,
    text: "no links here",
    x: 5000 + i,
  }));
  return [el, ...others];
}

/** Max measure calls over 400 clicks spread over the big element. */
function maxCallsPerClick(elements: TextLike[], lines: number) {
  const { counter, measure } = countingMeasure();
  let max = 0;
  let hits = 0;
  for (let run = 0; run < 400; run++) {
    const y = ((run * 37) % lines) * 25 + 5;
    counter.calls = 0;
    if (hitTestTextLink(elements, { x: 250 + (run % 90), y }, measure)) {
      hits++;
    }
    max = Math.max(max, counter.calls);
  }
  return { max, hits };
}

// The cost of a click is counted, not timed: wall-clock asserts flake under machine load
// (toimprove #20/#21). What keeps a click under 1 ms is that it measures one line with a
// binary search (about log2(line length) calls) and never measures other elements or lines.
describe("text link hit-test cost (500-line element)", () => {
  it("measures one line by binary search: O(log line length) calls per click", () => {
    const { max, hits } = maxCallsPerClick(scene(500, 200), 500);
    const longest = Math.max(
      ...bigElement(500)
        .text.split("\n")
        .map((l) => l.length),
    );
    // line start + line width + binary search + one fragment (start, x1, x2)
    const bound = 2 + Math.ceil(Math.log2(longest + 1)) + 3;
    expect(hits).toBeGreaterThan(0);
    expect(max).toBeLessThanOrEqual(bound);
  });

  it("does not grow with line count or with elements that have no links", () => {
    const small = maxCallsPerClick(scene(50, 0), 50).max;
    const big = maxCallsPerClick(scene(5000, 2000), 5000).max;
    expect(big).toBe(small);
  });

  it("logs wall-clock p50/p95 for information (not asserted)", () => {
    const elements = scene(500, 200);
    const { measure } = countingMeasure();
    const times: number[] = [];
    for (let run = 0; run < 400; run++) {
      const y = ((run * 37) % 500) * 25 + 5;
      const s = performance.now();
      hitTestTextLink(elements, { x: 250 + (run % 90), y }, measure);
      times.push(performance.now() - s);
    }
    times.sort((a, b) => a - b);
    const p = (q: number) => times[Math.floor(q * (times.length - 1))];
    // eslint-disable-next-line no-console
    console.info(
      `link hit-test 500 lines: p50 ${p(0.5).toFixed(3)} ms, p95 ${p(
        0.95,
      ).toFixed(3)} ms, max ${times[times.length - 1].toFixed(3)} ms`,
    );
    expect(times.length).toBe(400);
  });
});
