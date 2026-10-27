/**
 * Canvas2D label overlay. Zoom LOD (high-degree nodes appear first, fading in), top-degree first,
 * grid collision culling, at most `maxLabels` per frame. Label strings come from a lazy callback
 * and are only requested for candidates that survive the on-screen test.
 */
import type { CameraState } from "./renderer/types";

export const MAX_LABELS = 150;
/** Upper bound on on-screen strings requested per layout, so dense screens stay cheap. */
const MAX_CANDIDATES = 800;
const CELL_W = 24;
const CELL_H = 14;
const CHAR_W = 6.2;
const OFFSET_X = 6;
const OFFSET_Y = -4;

export interface LabelOptions {
  /** Lazy label text for node i. */
  label: (i: number) => string;
  maxLabels?: number;
  /** Zoom at which the least important nodes start to show text (setting). */
  fadeScale?: number;
  font?: string;
}

export interface LabelFrame {
  positions: Float32Array;
  camera: CameraState;
  /** Viewport in CSS px. */
  width: number;
  height: number;
  mask?: Uint8Array | null;
  /** Hovered node (-1 none): always labelled, never culled by collisions. */
  hovered?: number;
  /** Neighbours of the hovered node: labelled first (collision-checked), full alpha. */
  always?: ArrayLike<number> | null;
}

export class LabelLayer {
  maxLabels: number;
  fadeScale: number;
  font: string;

  private n = 0;
  private order = new Uint32Array(0);
  private importance = new Float32Array(0);
  private stamp = new Uint32Array(0);
  private stampId = 0;
  private cols = 0;
  private rows = 0;
  private occ = new Uint8Array(0);

  /** Result of the last `layout()`: `count` entries. */
  count = 0;
  readonly index: Uint32Array;
  readonly sx: Float32Array;
  readonly sy: Float32Array;
  readonly alpha: Float32Array;
  readonly text: string[];

  constructor(private readonly opts: LabelOptions) {
    this.maxLabels = opts.maxLabels ?? MAX_LABELS;
    this.fadeScale = opts.fadeScale ?? 0.5;
    this.font = opts.font ?? "11px sans-serif";
    this.index = new Uint32Array(this.maxLabels);
    this.sx = new Float32Array(this.maxLabels);
    this.sy = new Float32Array(this.maxLabels);
    this.alpha = new Float32Array(this.maxLabels);
    this.text = new Array<string>(this.maxLabels).fill("");
  }

  /** Orders nodes by degree (counting sort, O(n + maxDegree)) and derives importance 0..1. */
  setGraph(n: number, degree: ArrayLike<number>): void {
    this.n = n;
    let maxDeg = 0;
    for (let i = 0; i < n; i++) {
      if (degree[i] > maxDeg) {
        maxDeg = degree[i];
      }
    }
    const count = new Uint32Array(maxDeg + 2);
    for (let i = 0; i < n; i++) {
      count[maxDeg - degree[i] + 1]++; // descending degree
    }
    for (let d = 0; d <= maxDeg; d++) {
      count[d + 1] += count[d];
    }
    this.order = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      this.order[count[maxDeg - degree[i]]++] = i;
    }
    this.importance = new Float32Array(n);
    const norm = 1 / Math.sqrt(Math.max(1, maxDeg));
    for (let i = 0; i < n; i++) {
      this.importance[i] = Math.min(1, Math.sqrt(degree[i]) * norm);
    }
    this.stamp = new Uint32Array(n);
    this.stampId = 0;
  }

  private ensureGrid(w: number, h: number): void {
    const cols = Math.ceil(w / CELL_W) + 2;
    const rows = Math.ceil(h / CELL_H) + 2;
    if (cols !== this.cols || rows !== this.rows) {
      this.cols = cols;
      this.rows = rows;
      this.occ = new Uint8Array(cols * rows);
    }
  }

  /** Cheap overlap test + claim on the occupancy grid. */
  private claim(
    x: number,
    y: number,
    textLen: number,
    force: boolean,
  ): boolean {
    const x0 = x + OFFSET_X;
    const y0 = y + OFFSET_Y - 10;
    const cx0 = Math.max(0, Math.floor(x0 / CELL_W));
    const cx1 = Math.min(
      this.cols - 1,
      Math.floor((x0 + textLen * CHAR_W) / CELL_W),
    );
    const cy0 = Math.max(0, Math.floor(y0 / CELL_H));
    const cy1 = Math.min(this.rows - 1, Math.floor((y0 + 13) / CELL_H));
    const { occ, cols } = this;
    if (!force) {
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          if (occ[cy * cols + cx]) {
            return false;
          }
        }
      }
    }
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        occ[cy * cols + cx] = 1;
      }
    }
    return true;
  }

  private place(
    x: number,
    y: number,
    i: number,
    alpha: number,
    force: boolean,
  ): boolean {
    const s = this.opts.label(i);
    if (!s || !this.claim(x, y, s.length, force)) {
      return false;
    }
    const k = this.count++;
    this.index[k] = i;
    this.sx[k] = x;
    this.sy[k] = y;
    this.alpha[k] = alpha;
    this.text[k] = s;
    return true;
  }

  private tryAdd(
    f: LabelFrame,
    i: number,
    alpha: number,
    force: boolean,
  ): boolean {
    const { camera: c, positions: p } = f;
    const x = (p[2 * i] - c.x) * c.scale + f.width / 2;
    const y = (p[2 * i + 1] - c.y) * c.scale + f.height / 2;
    if (x < 0 || y < 0 || x > f.width || y > f.height) {
      return false;
    }
    return this.place(x, y, i, alpha, force);
  }

  /** Computes which labels to draw (no canvas access). Returns the count. */
  layout(f: LabelFrame): number {
    this.count = 0;
    if (this.n === 0) {
      return 0;
    }
    this.ensureGrid(f.width, f.height);
    this.occ.fill(0);
    const id = ++this.stampId;
    const max = this.maxLabels;
    const mask = f.mask;
    const hovered = f.hovered ?? -1;
    if (
      hovered >= 0 &&
      !(mask && mask[hovered]) &&
      this.tryAdd(f, hovered, 1, true)
    ) {
      this.stamp[hovered] = id;
    }
    if (f.always) {
      for (let k = 0; k < f.always.length && this.count < max; k++) {
        const i = f.always[k];
        if (this.stamp[i] === id || (mask && mask[i])) {
          continue;
        }
        if (this.tryAdd(f, i, 1, false)) {
          this.stamp[i] = id;
        }
      }
    }
    const cam = f.camera;
    const scale = cam.scale;
    const hw = f.width / 2;
    const hh = f.height / 2;
    const fade = this.fadeScale;
    let tried = 0;
    for (
      let k = 0;
      k < this.n && this.count < max && tried < MAX_CANDIDATES;
      k++
    ) {
      const i = this.order[k];
      // importance is non-increasing along `order`, so the first invisible one ends the scan
      const z = fade * (1 - 0.85 * this.importance[i]) + 1e-4;
      const a = Math.min(1, Math.max(0, (scale / z - 1) * 2));
      if (a <= 0) {
        break;
      }
      if (this.stamp[i] === id || (mask && mask[i])) {
        continue;
      }
      const x = (f.positions[2 * i] - cam.x) * scale + hw;
      const y = (f.positions[2 * i + 1] - cam.y) * scale + hh;
      if (x < 0 || y < 0 || x > f.width || y > f.height) {
        continue;
      }
      tried++;
      this.place(x, y, i, a, false);
    }
    return this.count;
  }

  /** layout() + draw into an overlay 2D context (cleared first). */
  draw(
    ctx: CanvasRenderingContext2D,
    f: LabelFrame,
    colour: string,
    dpr = 1,
  ): number {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, f.width, f.height);
    const count = this.layout(f);
    ctx.font = this.font;
    ctx.fillStyle = colour;
    ctx.textBaseline = "alphabetic";
    for (let k = 0; k < count; k++) {
      ctx.globalAlpha = this.alpha[k];
      ctx.fillText(this.text[k], this.sx[k] + OFFSET_X, this.sy[k] + OFFSET_Y);
    }
    ctx.globalAlpha = 1;
    return count;
  }
}
