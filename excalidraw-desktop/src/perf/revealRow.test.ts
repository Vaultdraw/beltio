import { computeWindow } from "../components/tree/useTreeWindow";

import { nextRevealScroll } from "./perfKit";

describe("windowed tree row lookup (20,000-note vault)", () => {
  it("a 205-row root list mounts only the first screen, so Projects is not in the DOM", () => {
    // Ideas, Journal, Meetings, 200 Notes-N folders, Projects, Sketches: Projects is row 203.
    const win = computeWindow(205, 0, 800);
    expect(win.end - win.start).toBeLessThan(60);
    expect(203).toBeGreaterThanOrEqual(win.end);
  });

  it("steps one screen down and wraps to the top after the end", () => {
    expect(nextRevealScroll(0, 800, 5740)).toBe(640);
    expect(nextRevealScroll(100, 100, 5740)).toBe(300);
    expect(nextRevealScroll(4940, 800, 5740)).toBe(0);
  });

  it("covers the whole list in a bounded number of steps", () => {
    let top = 0;
    let steps = 0;
    do {
      top = nextRevealScroll(top, 800, 5740);
      steps++;
    } while (top !== 0 && steps < 50);
    expect(steps).toBeLessThan(15);
  });
});
