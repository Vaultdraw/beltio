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

/**
 * The big element at the bottom, then `plain` link-less elements and `linked`
 * link-bearing ones, all far from the clicks, above it (the hit test walks
 * topmost first, so it passes every one of them on each click).
 */
function scene(lines: number, plain: number, linked = 0): TextLike[] {
  const el = bigElement(lines);
  const far = (i: number, text: string) => ({
    ...el,
    id: `o${i}`,
    text,
    height: 25,
    x: 50_000 + i * 10,
  });
  return [
    el,
    ...Array.from({ length: plain }, (_, i) => far(i, "no links here")),
    ...Array.from({ length: linked }, (_, i) =>
      far(plain + i, `see [[Far ${i}]]`),
    ),
  ];
}

/** Wraps each element so reads of `text` (the per-element work) are counted by id. */
function countingTextReads(elements: TextLike[]) {
  const reads = new Map<string, number>();
  const wrapped = elements.map(
    (el) =>
      new Proxy(el, {
        get(target, key, receiver) {
          if (key === "text") {
            reads.set(target.id, (reads.get(target.id) ?? 0) + 1);
          }
          return Reflect.get(target, key, receiver);
        },
      }),
  );
  return { wrapped, reads };
}

const CLICKS = 400;
const clickAt = (run: number, lines: number) => ({
  x: 250 + (run % 90),
  y: ((run * 37) % lines) * 25 + 5,
});

/**
 * Over 400 clicks spread over the big element: the max measure calls per
 * click, hits, and the max text reads of any other element per click. Logs
 * wall-clock p50/p95 for information only (never asserted: it flakes under
 * load, toimprove #20/#21).
 */
function costPerClick(elements: TextLike[], lines: number) {
  const { counter, measure } = countingMeasure();
  const { wrapped, reads } = countingTextReads(elements);
  const times: number[] = [];
  let max = 0;
  let hits = 0;
  let maxOtherReads = 0;
  for (let run = 0; run < CLICKS; run++) {
    counter.calls = 0;
    reads.clear();
    const s = performance.now();
    if (hitTestTextLink(wrapped, clickAt(run, lines), measure)) {
      hits++;
    }
    times.push(performance.now() - s);
    max = Math.max(max, counter.calls);
    for (const [id, n] of reads) {
      if (id !== "big") {
        maxOtherReads = Math.max(maxOtherReads, n);
      }
    }
  }
  times.sort((a, b) => a - b);
  const p = (q: number) => times[Math.floor(q * (times.length - 1))].toFixed(3);
  // eslint-disable-next-line no-console
  console.info(
    `link hit-test ${lines} lines, ${
      elements.length - 1
    } other elements: p50 ${p(0.5)} ms, p95 ${p(0.95)} ms`,
  );
  return { max, hits, maxOtherReads };
}

// The cost of a click is counted, not timed: wall-clock asserts flake under machine load
// (toimprove #20/#21). What keeps a click under 1 ms: other elements cost one `text` scan
// each and are never measured, and the clicked element measures one line by binary search
// (about log2(line length) calls).
describe("text link hit-test cost (500-line element)", () => {
  it("measures one line by binary search: O(log line length) calls per click", () => {
    const { max, hits } = costPerClick(scene(500, 200), 500);
    const longest = Math.max(
      ...bigElement(500)
        .text.split("\n")
        .map((l) => l.length),
    );
    // line start + line width + binary search + one fragment (start, x1, x2)
    const bound = 2 + Math.ceil(Math.log2(longest + 1)) + 3;
    expect(hits).toBe(CLICKS);
    expect(max).toBeLessThanOrEqual(bound);
  });

  it("measure calls do not grow with line count or with other elements, linked or not", () => {
    const small = costPerClick(scene(50, 0), 50).max;
    const big = costPerClick(scene(5000, 2000, 2000), 5000).max;
    expect(big).toBe(small);
  });

  it("every other element costs at most one text scan per click", () => {
    const { maxOtherReads, hits } = costPerClick(scene(500, 2000, 2000), 500);
    expect(hits).toBe(CLICKS);
    expect(maxOtherReads).toBe(1);
  });
});
