/**
 * Fast-scroll detector. While the grid flies past (above FAST_VIEWPORTS
 * viewport heights per second) tiles that mount would start a lookup and a
 * render for a thumbnail that is gone a frame later, and a started render
 * cannot be cancelled. The gallery defers their watches until the scroll has
 * been quiet for SETTLE_MS (or slows down).
 */
export const FAST_VIEWPORTS_PER_SECOND = 1.5;
export const SETTLE_MS = 120;

export interface ScrollSettle {
  /** A scroll event at `top`; returns whether the grid is now scrolling fast. */
  note(top: number, viewportHeight: number, now: number): boolean;
  dispose(): void;
}

export const createScrollSettle = (
  onChange: (fast: boolean) => void,
): ScrollSettle => {
  let fast = false;
  let lastTop: number | null = null;
  let lastTime = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const set = (next: boolean) => {
    if (next !== fast) {
      fast = next;
      onChange(fast);
    }
  };
  const clear = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    note(top, viewportHeight, now) {
      const dt = now - lastTime;
      const speed =
        lastTop === null || dt <= 0 ? 0 : (Math.abs(top - lastTop) / dt) * 1000;
      lastTop = top;
      lastTime = now;
      if (speed > FAST_VIEWPORTS_PER_SECOND * Math.max(1, viewportHeight)) {
        set(true);
      }
      if (fast) {
        clear();
        timer = setTimeout(() => {
          timer = null;
          set(false);
        }, SETTLE_MS);
      }
      return fast;
    },
    dispose: clear,
  };
};
