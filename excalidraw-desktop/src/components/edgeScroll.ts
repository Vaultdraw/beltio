/**
 * Edge auto-scroll for drags inside a scrolling area (Zed and Obsidian tab
 * strips, file trees): near an edge, or past it, the area scrolls toward it
 * while the pointer is held, faster the closer to (or beyond) the edge.
 */

export const EDGE_ZONE_PX = 40;
export const EDGE_MAX_SPEED = 18;

/** Pixels to scroll per frame for pointer `pos` in the span [min, max]: negative toward min, 0 in the middle. */
export const edgeSpeed = (
  pos: number,
  min: number,
  max: number,
  zone = EDGE_ZONE_PX,
  maxSpeed = EDGE_MAX_SPEED,
): number => {
  // a span too small for two zones: split it in half
  const z = Math.min(zone, Math.max(0, (max - min) / 2));
  if (z <= 0) {
    return 0;
  }
  if (pos < min + z) {
    return -Math.min(maxSpeed, Math.ceil((maxSpeed * (min + z - pos)) / z));
  }
  if (pos > max - z) {
    return Math.min(maxSpeed, Math.ceil((maxSpeed * (pos - (max - z))) / z));
  }
  return 0;
};

/**
 * Scroll `el` horizontally every frame while the pointer sits near its left
 * or right edge. `getX` gives the latest pointer x; `onScrolled` runs after a
 * frame that moved the content. Returns the stop function.
 */
export function startHorizontalEdgeScroll(
  el: HTMLElement,
  getX: () => number,
  onScrolled: () => void,
): () => void {
  const win = el.ownerDocument.defaultView;
  if (!win) {
    return () => {};
  }
  let frame: number | undefined;
  const tick = () => {
    const r = el.getBoundingClientRect();
    const speed = edgeSpeed(getX(), r.left, r.right);
    if (speed !== 0) {
      const before = el.scrollLeft;
      el.scrollLeft = before + speed;
      if (el.scrollLeft !== before) {
        onScrolled();
      }
    }
    frame = win.requestAnimationFrame(tick);
  };
  frame = win.requestAnimationFrame(tick);
  return () => {
    if (frame !== undefined) {
      win.cancelAnimationFrame(frame);
      frame = undefined;
    }
  };
}
