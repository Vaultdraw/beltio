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

/** Fade-in and fade-out times of a label (ms). Out is slower: a label never pops away. */
export const FADE_IN_MS = 140;
export const FADE_OUT_MS = 260;
/** A zoom change beyond this ratio (|ln scale ratio|) drops the "keep what is shown" priority. */
const RESELECT_LN = 0.12;
/** A label the layout dropped (a collision) cannot come back for this long: no flicker cycles. */
export const COOLDOWN_MS = 600;
/** px: a shown label tolerates this much overlap; a new one needs this much clear space. */
const STICKY_SLACK = 5;
const NEW_MARGIN = 5;
/** Longest frame step the fade uses (a stalled tab does not skip the fade). */
const MAX_DT_MS = 64;

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
  /** Time since the previous frame in ms (drives the fades in `draw`; default one 60 Hz frame). */
  dtMs?: number;
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

  // Keep-what-is-shown state (see `layout`).
  private prev: Uint32Array;
  private prevCount = 0;
  private prevScale = 0;
  private clock = 0;
  private dropAt = new Float64Array(0);

  // Fade state (see `draw`): the displayed alpha of every node that has a label now or is fading out.
  private cur = new Float32Array(0);
  private liveIdx: Uint32Array;
  private liveAlpha: Float32Array;
  private liveText: string[];
  private liveCount = 0;
  private nextIdx: Uint32Array;
  private nextAlpha: Float32Array;
  private nextText: string[];
  private tgtStamp = new Uint32Array(0);
  /** True while a label is still fading: the caller keeps its frame loop going. */
  animating = false;
  /**
   * Largest opacity change of any one label in one frame since the last reset, as a multiple of what
   * the fade allows for that frame (<= 1 always; a label that popped would read far above 1).
   */
  worstStep = 0;

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
    this.prev = new Uint32Array(this.maxLabels);
    const live = this.maxLabels * 3;
    this.liveIdx = new Uint32Array(live);
    this.liveAlpha = new Float32Array(live);
    this.liveText = new Array<string>(live).fill("");
    this.nextIdx = new Uint32Array(live);
    this.nextAlpha = new Float32Array(live);
    this.nextText = new Array<string>(live).fill("");
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
    this.dropAt = new Float64Array(n).fill(-COOLDOWN_MS);
    this.cur = new Float32Array(n);
    this.tgtStamp = new Uint32Array(n);
    this.liveCount = 0;
    this.prevCount = 0;
    this.animating = false;
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
    pad = 0,
  ): boolean {
    const x0 = x + OFFSET_X;
    const y0 = y + OFFSET_Y - 10;
    const w = textLen * CHAR_W;
    const col = (v: number) =>
      Math.min(this.cols - 1, Math.max(0, Math.floor(v / CELL_W)));
    const row = (v: number) =>
      Math.min(this.rows - 1, Math.max(0, Math.floor(v / CELL_H)));
    const { occ, cols } = this;
    if (!force) {
      // The test box is the text box grown (new label) or shrunk (one already shown) by `pad`:
      // a shown label tolerates a slight overlap, a newcomer needs clear space.
      const tx0 = col(x0 - pad);
      const tx1 = col(x0 + w + pad);
      const ty0 = row(y0 - pad);
      const ty1 = row(y0 + 13 + pad);
      for (let cy = ty0; cy <= ty1; cy++) {
        for (let cx = tx0; cx <= tx1; cx++) {
          if (occ[cy * cols + cx]) {
            return false;
          }
        }
      }
    }
    const cx0 = col(x0);
    const cx1 = col(x0 + w);
    const cy0 = row(y0);
    const cy1 = row(y0 + 13);
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
    pad = 0,
  ): boolean {
    const s = this.opts.label(i);
    if (!s || !this.claim(x, y, s.length, force, pad)) {
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
    pad = 0,
  ): boolean {
    const { camera: c, positions: p } = f;
    const x = (p[2 * i] - c.x) * c.scale + f.width / 2;
    const y = (p[2 * i + 1] - c.y) * c.scale + f.height / 2;
    if (x < 0 || y < 0 || x > f.width || y > f.height) {
      return false;
    }
    return this.place(x, y, i, alpha, force, pad);
  }

  /** Zoom LOD: alpha 0..1 of node `i` at `scale` (continuous in scale: no steps). */
  private lod(i: number, scale: number): number {
    const z = this.fadeScale * (1 - 0.85 * this.importance[i]) + 1e-4;
    return Math.min(1, Math.max(0, (scale / z - 1) * 2));
  }

  /**
   * Computes which labels to draw (no canvas access). Returns the count.
   *
   * Stable across frames (this is what stops the blinking while nodes drift): labels chosen in the
   * previous layout are claimed first, in their old order, so a node that sweeps past does not
   * flip a neighbour's label on and off. The priority resets when the zoom changes noticeably,
   * where the best set by degree is wanted again.
   */
  layout(f: LabelFrame): number {
    this.count = 0;
    if (this.n === 0) {
      return 0;
    }
    this.clock += Math.min(MAX_DT_MS, Math.max(0, f.dtMs ?? 1000 / 60));
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
    const sticky =
      this.prevScale > 0 &&
      Math.abs(Math.log(scale / this.prevScale)) < RESELECT_LN;
    if (sticky) {
      for (let k = 0; k < this.prevCount && this.count < max; k++) {
        const i = this.prev[k];
        if (this.stamp[i] === id || (mask && mask[i])) {
          continue;
        }
        const a = this.lod(i, scale);
        if (a > 0 && this.tryAdd(f, i, a, false, -STICKY_SLACK)) {
          this.stamp[i] = id;
        }
      }
    }
    let tried = 0;
    for (
      let k = 0;
      k < this.n && this.count < max && tried < MAX_CANDIDATES;
      k++
    ) {
      const i = this.order[k];
      // importance is non-increasing along `order`, so the first invisible one ends the scan
      const a = this.lod(i, scale);
      if (a <= 0) {
        break;
      }
      if (this.stamp[i] === id || (mask && mask[i])) {
        continue;
      }
      if (sticky && this.clock - this.dropAt[i] < COOLDOWN_MS) {
        continue; // dropped a moment ago: stays away until the cooldown is over
      }
      const x = (f.positions[2 * i] - cam.x) * scale + hw;
      const y = (f.positions[2 * i + 1] - cam.y) * scale + hh;
      if (x < 0 || y < 0 || x > f.width || y > f.height) {
        continue;
      }
      tried++;
      this.place(x, y, i, a, false, sticky ? NEW_MARGIN : 0);
    }
    // Note which labels were just dropped, then remember the set.
    for (let k = 0; k < this.prevCount; k++) {
      const i = this.prev[k];
      if (this.stamp[i] !== id && sticky) {
        this.dropAt[i] = this.clock;
      }
    }
    this.prevCount = 0;
    for (let k = 0; k < this.count; k++) {
      this.prev[this.prevCount++] = this.index[k];
    }
    this.prevScale = scale;
    return this.count;
  }

  /**
   * layout() + draw into an overlay 2D context (cleared first). Each label eases in and out
   * (FADE_IN_MS / FADE_OUT_MS), so a label the layout drops fades away instead of vanishing and
   * one that returns fades back. `animating` says whether another frame is needed to finish.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    f: LabelFrame,
    colour: string,
    dpr = 1,
  ): number {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, f.width, f.height);
    const count = this.layout(f);
    const dt = Math.min(MAX_DT_MS, Math.max(0, f.dtMs ?? 1000 / 60));
    const up = dt / FADE_IN_MS;
    const down = dt / FADE_OUT_MS;
    const id = this.stampId; // this frame's chosen labels carry it in `stamp`
    const cap = this.nextIdx.length;
    let n = 0;
    let animating = false;
    // Chosen labels ease towards their zoom alpha ...
    for (let k = 0; k < count && n < cap; k++) {
      const i = this.index[k];
      const target = this.alpha[k];
      const before = this.cur[i];
      let a = before;
      a = a < target ? Math.min(target, a + up) : Math.max(target, a - down);
      this.cur[i] = a;
      if (dt > 0) {
        this.worstStep = Math.max(
          this.worstStep,
          a > before ? (a - before) / up : (before - a) / down,
        );
      }
      this.tgtStamp[i] = id;
      if (a !== target) {
        animating = true;
      }
      if (a > 0) {
        this.nextIdx[n] = i;
        this.nextAlpha[n] = a;
        this.nextText[n++] = this.text[k];
      }
    }
    // ... and the ones that were shown and are not chosen now fade out.
    for (let k = 0; k < this.liveCount && n < cap; k++) {
      const i = this.liveIdx[k];
      if (this.tgtStamp[i] === id) {
        continue;
      }
      const a = Math.max(0, this.cur[i] - down);
      if (dt > 0) {
        this.worstStep = Math.max(this.worstStep, (this.cur[i] - a) / down);
      }
      this.cur[i] = a;
      if (a > 0) {
        animating = true;
        this.nextIdx[n] = i;
        this.nextAlpha[n] = a;
        this.nextText[n++] = this.liveText[k];
      }
    }
    [this.liveIdx, this.nextIdx] = [this.nextIdx, this.liveIdx];
    [this.liveAlpha, this.nextAlpha] = [this.nextAlpha, this.liveAlpha];
    [this.liveText, this.nextText] = [this.nextText, this.liveText];
    this.liveCount = n;
    this.animating = animating;

    ctx.font = this.font;
    ctx.fillStyle = colour;
    ctx.textBaseline = "alphabetic";
    const { camera: c, positions: p } = f;
    for (let k = 0; k < n; k++) {
      const i = this.liveIdx[k];
      const x = (p[2 * i] - c.x) * c.scale + f.width / 2;
      const y = (p[2 * i + 1] - c.y) * c.scale + f.height / 2;
      ctx.globalAlpha = this.liveAlpha[k];
      ctx.fillText(this.liveText[k], x + OFFSET_X, y + OFFSET_Y);
    }
    ctx.globalAlpha = 1;
    return n;
  }
}
