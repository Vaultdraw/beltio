/**
 * Uniform grid for hover picking: counting-sort build (O(n), buffers reused across rebuilds),
 * O(1)-ish lookup. Rebuild only when the layout settles or a drag ends, not every tick.
 */
import { nodeZoomFactor } from "./renderer/shared";

export class HitGrid {
  private n = 0;
  private g = 1;
  private x0 = 0;
  private y0 = 0;
  private cell = 1;
  private items = new Int32Array(0);
  private cellOf = new Int32Array(0);
  private start = new Int32Array(2);
  private pos: Float32Array = new Float32Array(0);
  private radius: Float32Array = new Float32Array(0);
  private mask: Uint8Array | null = null;
  private maxRadius = 0;

  /**
   * `positions` and `radius` are referenced, not copied: pass stable arrays (copy the layout
   * client's transient buffer first). Hidden nodes (`mask[i] === 1`) are never picked.
   */
  build(
    positions: Float32Array,
    radius: Float32Array,
    n: number,
    mask: Uint8Array | null = null,
  ): void {
    this.n = n;
    this.pos = positions;
    this.radius = radius;
    this.mask = mask;
    if (this.items.length < n) {
      this.items = new Int32Array(n);
      this.cellOf = new Int32Array(n);
    }
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let maxR = 0;
    for (let i = 0; i < n; i++) {
      const x = positions[2 * i];
      const y = positions[2 * i + 1];
      if (x < x0) {
        x0 = x;
      }
      if (x > x1) {
        x1 = x;
      }
      if (y < y0) {
        y0 = y;
      }
      if (y > y1) {
        y1 = y;
      }
      if (radius[i] > maxR) {
        maxR = radius[i];
      }
    }
    this.maxRadius = maxR;
    if (n === 0) {
      x0 = y0 = 0;
      x1 = y1 = 1;
    }
    const side = Math.max(x1 - x0, y1 - y0, 1);
    const g = Math.max(1, Math.min(512, Math.ceil(Math.sqrt(n / 2))));
    this.g = g;
    this.x0 = x0;
    this.y0 = y0;
    this.cell = side / g + 1e-6;
    const cells = g * g;
    if (this.start.length < cells + 1) {
      this.start = new Int32Array(cells + 1);
    }
    const start = this.start;
    start.fill(0, 0, cells + 1);
    const cellOf = this.cellOf;
    for (let i = 0; i < n; i++) {
      const c = this.cellIndex(positions[2 * i], positions[2 * i + 1]);
      cellOf[i] = c;
      start[c + 1]++;
    }
    for (let c = 0; c < cells; c++) {
      start[c + 1] += start[c];
    }
    // scatter, using start[c] as a moving cursor, then shift back
    const items = this.items;
    for (let i = 0; i < n; i++) {
      items[start[cellOf[i]]++] = i;
    }
    for (let c = cells; c > 0; c--) {
      start[c] = start[c - 1];
    }
    start[0] = 0;
  }

  private cellIndex(x: number, y: number): number {
    const g = this.g;
    const cx = Math.min(g - 1, Math.max(0, ((x - this.x0) / this.cell) | 0));
    const cy = Math.min(g - 1, Math.max(0, ((y - this.y0) / this.cell) | 0));
    return cy * g + cx;
  }

  /**
   * Nearest node whose on-screen disc (radius * zoom factor + `slopPx`) contains the world point
   * (wx, wy) at camera `scale`, or -1.
   */
  pick(wx: number, wy: number, scale: number, slopPx = 2): number {
    if (this.n === 0) {
      return -1;
    }
    const zf = nodeZoomFactor(scale);
    const reach = (this.maxRadius * zf + slopPx) / scale;
    const { g, cell, start, items, pos, radius, mask } = this;
    const gx0 = Math.max(0, ((wx - reach - this.x0) / cell) | 0);
    const gx1 = Math.min(g - 1, Math.floor((wx + reach - this.x0) / cell));
    const gy0 = Math.max(0, ((wy - reach - this.y0) / cell) | 0);
    const gy1 = Math.min(g - 1, Math.floor((wy + reach - this.y0) / cell));
    const inv = 1 / scale;
    let best = -1;
    let bestD = Infinity;
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const c = gy * g + gx;
        for (let k = start[c]; k < start[c + 1]; k++) {
          const i = items[k];
          if (mask && mask[i]) {
            continue;
          }
          const dx = pos[2 * i] - wx;
          const dy = pos[2 * i + 1] - wy;
          const d = dx * dx + dy * dy;
          const r = (radius[i] * zf + slopPx) * inv;
          if (d <= r * r && d < bestD) {
            bestD = d;
            best = i;
          }
        }
      }
    }
    return best;
  }
}
