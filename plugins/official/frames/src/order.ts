/** Slide order: pure functions over a drawing's frames. */

export interface FrameBox {
  id: string;
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Frames that carry a saved `order` come first, by that number; the rest follow in reading
 * order (rows from the top, each row left to right), so a drawing nobody ordered still plays
 * the way it reads.
 */
export function orderFrames(
  frames: readonly FrameBox[],
  orderOf: (id: string) => number | undefined,
): FrameBox[] {
  const numbered: { f: FrameBox; n: number }[] = [];
  const rest: FrameBox[] = [];
  for (const f of frames) {
    const n = orderOf(f.id);
    if (typeof n === "number" && Number.isFinite(n)) {
      numbered.push({ f, n });
    } else {
      rest.push(f);
    }
  }
  numbered.sort((a, b) => a.n - b.n);
  return [...numbered.map((x) => x.f), ...readingOrder(rest)];
}

/** Rows from the top (a row spans half the height of its first frame), each left to right. */
export function readingOrder(frames: readonly FrameBox[]): FrameBox[] {
  const byTop = [...frames].sort((a, b) => a.y - b.y || a.x - b.x);
  const out: FrameBox[] = [];
  let row: FrameBox[] = [];
  let rowTop = 0;
  let rowHeight = 0;
  const flush = () => {
    out.push(...row.sort((a, b) => a.x - b.x));
    row = [];
  };
  for (const f of byTop) {
    if (row.length > 0 && f.y - rowTop > rowHeight / 2) {
      flush();
    }
    if (row.length === 0) {
      rowTop = f.y;
      rowHeight = f.height;
    }
    row.push(f);
  }
  flush();
  return out;
}

/** What the panel and the strip call a frame: its name, else its place ("Frame 3"). */
export const labelOf = (f: FrameBox, index: number): string =>
  f.name?.trim() || `Frame ${index + 1}`;

/** The ids with the item at `from` moved to `to` (clamped); the same list when nothing moves. */
export function moveId(
  ids: readonly string[],
  from: number,
  to: number,
): string[] {
  const out = [...ids];
  if (from < 0 || from >= out.length) {
    return out;
  }
  const target = Math.max(0, Math.min(out.length - 1, to));
  const [id] = out.splice(from, 1);
  out.splice(target, 0, id);
  return out;
}

/**
 * Where a presentation starts: a selected frame, else the frame the view centre is in, else the
 * frame nearest to the centre, else the first.
 */
export function startIndex(
  slides: readonly FrameBox[],
  selection: readonly string[],
  centre: { x: number; y: number },
): number {
  if (slides.length === 0) {
    return -1;
  }
  const picked = slides.findIndex((f) => selection.includes(f.id));
  if (picked >= 0) {
    return picked;
  }
  let best = 0;
  let bestDistance = Infinity;
  slides.forEach((f, i) => {
    const dx = Math.max(f.x - centre.x, 0, centre.x - (f.x + f.width));
    const dy = Math.max(f.y - centre.y, 0, centre.y - (f.y + f.height));
    const d = Math.hypot(dx, dy);
    if (d < bestDistance) {
      best = i;
      bestDistance = d;
    }
  });
  return best;
}
