/**
 * Force layout on typed arrays (ported from the graph-bench spike L1): Barnes-Hut repulsion over a
 * quadtree rebuilt every tick in preallocated arrays, link springs with degree bias, centre
 * gravity, velocity decay and d3-like alpha cooling. No allocation per tick.
 *
 * Pure and environment-free: runs in the layout worker and in-thread (tests, fallback).
 */
import { buildCsr, type Csr } from "./localGraph";

/**
 * Obsidian-like force sliders. Ranges the UI should offer: centre 0-1, repel 0-20,
 * linkForce 0-2, linkDistance 5-200 (px in layout space).
 */
export interface ForceSettings {
  /** Pull of every node towards the origin. */
  centre: number;
  /** Strength of the node-node repulsion. */
  repel: number;
  /** Stiffness multiplier of the link springs. */
  linkForce: number;
  /** Rest length of a link. */
  linkDistance: number;
}

export const DEFAULT_FORCE_SETTINGS: Readonly<ForceSettings> = {
  centre: 0.3,
  repel: 10,
  linkForce: 1,
  linkDistance: 30,
};

/** Solver tuning (not user facing). */
export interface LayoutParams {
  /** Barnes-Hut opening angle; 0 = exact. */
  theta: number;
  alphaMin: number;
  /** Per-tick cooling rate; default reaches alphaMin from 1 in 300 ticks. */
  alphaDecay: number;
  /** Velocity kept per tick. */
  velocityDecay: number;
  /** Stop early when mean node speed stays below this fraction of the layout extent for 3 ticks. */
  settleSpeed: number;
  /** Dragging keeps every visible node live up to this many visible nodes; above it, 2-hop hood. */
  globalDragMax: number;
}

/** Visible-node limit for global (d3-style) drag reheat. */
export const GLOBAL_DRAG_MAX = 10000;

export const DEFAULT_LAYOUT_PARAMS: Readonly<LayoutParams> = {
  theta: 0.9,
  alphaMin: 0.001,
  alphaDecay: 1 - Math.pow(0.001, 1 / 300),
  velocityDecay: 0.6,
  settleSpeed: 0.0005,
  globalDragMax: GLOBAL_DRAG_MAX,
};

/** Start alpha for a cold layout, a warm start from a saved layout, and a reheat. */
export const ALPHA_COLD = 1;
export const ALPHA_WARM = 0.02;
export const ALPHA_REHEAT = 0.3;

export interface ForceLayoutInit {
  nodeCount: number;
  /** `(src, dst)` pairs. */
  edges: Uint32Array;
  /** `2 * n` x,y pairs. Owned and mutated by the layout. */
  positions: Float32Array;
  settings?: Partial<ForceSettings>;
  params?: Partial<LayoutParams>;
  /** 1 = node hidden by a client-side filter: no forces, never moves. */
  mask?: Uint8Array | null;
  /** Starting alpha. Defaults to ALPHA_COLD. */
  alpha?: number;
  /** Relax only the neighbourhood of these nodes (warm start for new nodes). */
  focus?: ArrayLike<number> | null;
  /** Hop count of the `focus` neighbourhood. Default 2. */
  focusDepth?: number;
}

const GRAVITY_PER_CENTRE = 0.02 / 0.3;
const CHARGE_PER_REPEL = 3;
const HOOD_DEPTH = 2;
const CALM_TICKS = 3;

export class ForceLayout {
  readonly n: number;
  /** Live positions; mutated every tick. */
  readonly positions: Float32Array;
  settings: ForceSettings;
  private readonly p: LayoutParams;
  private readonly edges: Uint32Array;
  private readonly m: number;

  private alpha_: number;
  private alphaTarget = 0;
  private settled_ = false;
  private calm = 0;
  private ticks_ = 0;

  private readonly V: Float32Array;
  private readonly fixed: Uint8Array;
  private hidden: Uint8Array | null = null;
  private readonly deg: Uint32Array;
  private readonly bias: Float32Array;
  private readonly str: Float32Array;

  // Active (moving) nodes: visible and, in hood mode, inside the neighbourhood.
  private readonly active: Int32Array;
  private activeCount = 0;
  private inHood: Uint8Array | null = null;
  private csr: Csr | null = null;
  private dragNode = -1;

  // Quadtree. nb: -1 internal/empty, >=0 leaf body, -2 aggregate leaf (coincident / depth limit).
  private readonly cap: number;
  private readonly ncx: Float32Array;
  private readonly ncy: Float32Array;
  private readonly nh: Float32Array;
  private readonly nm: Float32Array;
  private readonly mx: Float32Array;
  private readonly my: Float32Array;
  private readonly nb: Int32Array;
  private readonly nch: Int32Array;
  private readonly stack = new Int32Array(512);
  private cnt = 0;
  private extent = 1;
  private fx = 0;
  private fy = 0;
  private rnd = 0x9e3779b9;

  constructor(init: ForceLayoutInit) {
    const n = init.nodeCount;
    this.n = n;
    this.positions = init.positions;
    this.edges = init.edges;
    this.m = init.edges.length >> 1;
    this.settings = { ...DEFAULT_FORCE_SETTINGS, ...init.settings };
    this.p = { ...DEFAULT_LAYOUT_PARAMS, ...init.params };
    this.alpha_ = init.alpha ?? ALPHA_COLD;
    this.V = new Float32Array(2 * n);
    this.fixed = new Uint8Array(n);
    this.deg = new Uint32Array(n);
    this.bias = new Float32Array(this.m);
    this.str = new Float32Array(this.m);
    this.active = new Int32Array(n);
    const cap = 3 * n + 1024;
    this.cap = cap;
    this.ncx = new Float32Array(cap);
    this.ncy = new Float32Array(cap);
    this.nh = new Float32Array(cap);
    this.nm = new Float32Array(cap);
    this.mx = new Float32Array(cap);
    this.my = new Float32Array(cap);
    this.nb = new Int32Array(cap);
    this.nch = new Int32Array(4 * cap);
    this.hidden = init.mask ?? null;
    if (init.focus && init.focus.length > 0) {
      this.setHood(init.focus, init.focusDepth ?? HOOD_DEPTH);
    }
    this.refreshLinks();
    this.rebuildActive();
    this.settled_ = n === 0;
  }

  get alpha(): number {
    return this.alpha_;
  }

  get settled(): boolean {
    return this.settled_;
  }

  get tickCount(): number {
    return this.ticks_;
  }

  /** Approximate bytes held by the layout (excluding the caller's positions/edges). */
  get byteSize(): number {
    return (
      this.V.byteLength +
      this.fixed.byteLength +
      this.deg.byteLength +
      this.bias.byteLength +
      this.str.byteLength +
      this.active.byteLength +
      this.ncx.byteLength * 6 +
      this.nb.byteLength +
      this.nch.byteLength
    );
  }

  setSettings(s: Partial<ForceSettings>, alpha = ALPHA_REHEAT): void {
    this.settings = { ...this.settings, ...s };
    this.reheat(alpha);
  }

  /** Global reheat: leaves hood mode so every visible node can move again. */
  reheat(alpha = ALPHA_REHEAT): void {
    this.clearHood();
    this.wake(alpha);
  }

  setMask(mask: Uint8Array | null, alpha = 0.1): void {
    this.hidden = mask;
    this.refreshLinks();
    this.rebuildActive();
    this.wake(alpha);
  }

  /**
   * Pin `node` at (x, y) and hold alphaTarget at ALPHA_REHEAT (d3 drag). Up to `globalDragMax`
   * visible nodes every one stays live; above it only the 2-hop neighbourhood relaxes.
   */
  drag(node: number, x: number, y: number): void {
    if (this.dragNode !== node) {
      if (this.dragNode >= 0) {
        this.fixed[this.dragNode] = 0;
      }
      this.dragNode = node;
      if (this.visibleCount() <= this.p.globalDragMax) {
        this.clearHood();
      } else {
        this.setHood([node]);
        this.rebuildActive();
      }
    }
    this.fixed[node] = 1;
    this.positions[2 * node] = x;
    this.positions[2 * node + 1] = y;
    this.alphaTarget = ALPHA_REHEAT;
    this.wake(Math.max(this.alpha_, ALPHA_REHEAT));
  }

  /** Unpin the dragged node; the hood keeps cooling, then the layout settles. */
  release(): void {
    if (this.dragNode >= 0) {
      this.fixed[this.dragNode] = 0;
      this.dragNode = -1;
    }
    this.alphaTarget = 0;
  }

  /** Relax only the 2-hop neighbourhood of `seeds` from the current alpha. */
  focus(seeds: ArrayLike<number>, alpha = ALPHA_WARM): void {
    this.setHood(seeds);
    this.rebuildActive();
    this.wake(alpha);
  }

  private visibleCount(): number {
    const { hidden } = this;
    if (!hidden) {
      return this.n;
    }
    let c = 0;
    for (let i = 0; i < this.n; i++) {
      c += hidden[i] ? 0 : 1;
    }
    return c;
  }

  private wake(alpha: number): void {
    this.alpha_ = alpha;
    this.settled_ = false;
    this.calm = 0;
  }

  private setHood(seeds: ArrayLike<number>, depthLimit = HOOD_DEPTH): void {
    const csr = (this.csr ??= buildCsr(this.n, this.edges));
    const inHood = (this.inHood ??= new Uint8Array(this.n));
    inHood.fill(0);
    const queue: number[] = [];
    for (let i = 0; i < seeds.length; i++) {
      inHood[seeds[i]] = 1;
      queue.push(seeds[i]);
    }
    let levelEnd = queue.length;
    let depth = 0;
    for (let head = 0; head < queue.length; head++) {
      if (head === levelEnd) {
        depth++;
        levelEnd = queue.length;
      }
      if (depth >= depthLimit) {
        break;
      }
      const u = queue[head];
      for (let q = csr.offsets[u]; q < csr.offsets[u + 1]; q++) {
        const v = csr.targets[q];
        if (!inHood[v]) {
          inHood[v] = 1;
          queue.push(v);
        }
      }
    }
  }

  private clearHood(): void {
    if (this.inHood) {
      this.inHood = null;
      this.rebuildActive();
    }
  }

  private rebuildActive(): void {
    let c = 0;
    const { hidden, inHood } = this;
    for (let i = 0; i < this.n; i++) {
      if ((hidden && hidden[i]) || (inHood && !inHood[i])) {
        continue;
      }
      this.active[c++] = i;
    }
    this.activeCount = c;
  }

  /** Degree-biased spring weights over visible edges (edges to hidden nodes get strength 0). */
  private refreshLinks(): void {
    const { edges, hidden, deg, m } = this;
    deg.fill(0);
    for (let k = 0; k < m; k++) {
      const a = edges[2 * k];
      const b = edges[2 * k + 1];
      if (hidden && (hidden[a] || hidden[b])) {
        continue;
      }
      deg[a]++;
      deg[b]++;
    }
    for (let k = 0; k < m; k++) {
      const a = edges[2 * k];
      const b = edges[2 * k + 1];
      if (hidden && (hidden[a] || hidden[b])) {
        this.str[k] = 0;
        continue;
      }
      this.bias[k] = deg[a] / (deg[a] + deg[b]);
      this.str[k] = 1 / Math.min(deg[a], deg[b]);
    }
  }

  tick(): void {
    if (this.n === 0) {
      return;
    }
    const { p, positions: P, V, edges, str, bias, fixed } = this;
    const { settings } = this;
    this.alpha_ += (this.alphaTarget - this.alpha_) * p.alphaDecay;
    const alpha = this.alpha_;
    this.build();
    for (let a = 0; a < this.activeCount; a++) {
      const i = this.active[a];
      if (fixed[i]) {
        continue;
      }
      this.repel(i);
      V[2 * i] += this.fx * alpha;
      V[2 * i + 1] += this.fy * alpha;
    }
    const dist = settings.linkDistance;
    const kStr = settings.linkForce * alpha;
    const { inHood } = this;
    for (let k = 0; k < this.m; k++) {
      const w = str[k];
      if (w === 0) {
        continue;
      }
      const s = edges[2 * k];
      const t = edges[2 * k + 1];
      if (inHood && !(inHood[s] | inHood[t])) {
        continue;
      }
      let dx = P[2 * t] + V[2 * t] - P[2 * s] - V[2 * s];
      let dy = P[2 * t + 1] + V[2 * t + 1] - P[2 * s + 1] - V[2 * s + 1];
      const l = Math.hypot(dx, dy) || 1e-6;
      const f = ((l - dist) / l) * kStr * w;
      dx *= f;
      dy *= f;
      const bz = bias[k];
      V[2 * t] -= dx * bz;
      V[2 * t + 1] -= dy * bz;
      V[2 * s] += dx * (1 - bz);
      V[2 * s + 1] += dy * (1 - bz);
    }
    const grav = settings.centre * GRAVITY_PER_CENTRE * alpha;
    const keep = p.velocityDecay;
    let speed = 0;
    for (let a = 0; a < this.activeCount; a++) {
      const i = this.active[a];
      if (fixed[i]) {
        V[2 * i] = V[2 * i + 1] = 0;
        continue;
      }
      const vx = (V[2 * i] - P[2 * i] * grav) * keep;
      const vy = (V[2 * i + 1] - P[2 * i + 1] * grav) * keep;
      V[2 * i] = vx;
      V[2 * i + 1] = vy;
      P[2 * i] += vx;
      P[2 * i + 1] += vy;
      speed += Math.abs(vx) + Math.abs(vy);
    }
    this.ticks_++;
    if (this.alphaTarget === 0) {
      const mean = this.activeCount ? speed / this.activeCount : 0;
      this.calm = mean < p.settleSpeed * this.extent ? this.calm + 1 : 0;
      if (alpha < p.alphaMin || this.calm >= CALM_TICKS) {
        this.settle();
      }
    }
  }

  private settle(): void {
    this.settled_ = true;
    this.V.fill(0);
    this.clearHood();
  }

  /**
   * Barnes-Hut repulsion on every visible node (unscaled by alpha) into `out` (2 * n).
   * For tests and diagnostics.
   */
  repulsionForces(out: Float32Array): void {
    this.build();
    out.fill(0);
    for (let i = 0; i < this.n; i++) {
      if (this.hidden && this.hidden[i]) {
        continue;
      }
      this.repel(i);
      out[2 * i] = this.fx;
      out[2 * i + 1] = this.fy;
    }
  }

  private newNode(x: number, y: number, h: number): number {
    const id = this.cnt++;
    this.ncx[id] = x;
    this.ncy[id] = y;
    this.nh[id] = h;
    this.nm[id] = 0;
    this.nb[id] = -1;
    this.nch.fill(-1, 4 * id, 4 * id + 4);
    return id;
  }

  private build(): void {
    const { positions: P, hidden } = this;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < this.n; i++) {
      if (hidden && hidden[i]) {
        continue;
      }
      const x = P[2 * i];
      const y = P[2 * i + 1];
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
    }
    this.cnt = 0;
    if (x0 === Infinity) {
      this.newNode(0, 0, 1); // everything hidden: empty tree
      return;
    }
    this.extent = Math.max(x1 - x0, y1 - y0) + 1;
    this.newNode((x0 + x1) / 2, (y0 + y1) / 2, this.extent / 2);
    for (let i = 0; i < this.n; i++) {
      if (!(hidden && hidden[i])) {
        this.insert(i);
      }
    }
  }

  private insert(i: number): void {
    const { positions: P, ncx, ncy, nh, nm, mx, my, nb, nch } = this;
    const px = P[2 * i];
    const py = P[2 * i + 1];
    let nd = 0;
    for (;;) {
      const mass = nm[nd];
      if (mass === 0) {
        nm[nd] = 1;
        mx[nd] = px;
        my[nd] = py;
        nb[nd] = i;
        return;
      }
      mx[nd] = (mx[nd] * mass + px) / (mass + 1);
      my[nd] = (my[nd] * mass + py) / (mass + 1);
      nm[nd] = mass + 1;
      const b = nb[nd];
      if (b === -2) {
        return;
      }
      if (b >= 0) {
        const bx = P[2 * b];
        const by = P[2 * b + 1];
        if (
          nh[nd] < 1e-3 ||
          this.cnt + 2 > this.cap ||
          (bx === px && by === py)
        ) {
          nb[nd] = -2;
          return;
        }
        nb[nd] = -1;
        const q = (bx > ncx[nd] ? 1 : 0) | (by > ncy[nd] ? 2 : 0);
        const h = nh[nd] / 2;
        const c = this.newNode(
          ncx[nd] + (q & 1 ? h : -h),
          ncy[nd] + (q & 2 ? h : -h),
          h,
        );
        nm[c] = 1;
        mx[c] = bx;
        my[c] = by;
        nb[c] = b;
        nch[4 * nd + q] = c;
      }
      const q = (px > ncx[nd] ? 1 : 0) | (py > ncy[nd] ? 2 : 0);
      let c = nch[4 * nd + q];
      if (c < 0) {
        const h = nh[nd] / 2;
        c = this.newNode(
          ncx[nd] + (q & 1 ? h : -h),
          ncy[nd] + (q & 2 ? h : -h),
          h,
        );
        nch[4 * nd + q] = c;
      }
      nd = c;
    }
  }

  private jitter(): number {
    // xorshift32: deterministic, allocation-free
    let x = this.rnd;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rnd = x;
    return (x >>> 0) / 4294967296 - 0.5;
  }

  /** Repulsion on node i into this.fx/fy (charge / distance, like d3-force). */
  private repel(i: number): void {
    const { positions: P, nm, mx, my, nb, nh, nch, stack } = this;
    const K = this.settings.repel * CHARGE_PER_REPEL;
    const theta2 = this.p.theta * this.p.theta;
    const px = P[2 * i];
    const py = P[2 * i + 1];
    let vx = 0;
    let vy = 0;
    let sp = 0;
    stack[sp++] = 0;
    while (sp) {
      const nd = stack[--sp];
      const mass = nm[nd];
      if (mass === 0) {
        continue;
      }
      let dx = mx[nd] - px;
      let dy = my[nd] - py;
      let d2 = dx * dx + dy * dy;
      const b = nb[nd];
      if (b >= 0 || b === -2) {
        if (b === i) {
          continue;
        }
        if (d2 < 1e-6) {
          dx = this.jitter();
          dy = this.jitter();
          d2 = dx * dx + dy * dy;
        }
        if (d2 < 1) {
          d2 = 1;
        }
        const f = (K * mass) / d2;
        vx -= dx * f;
        vy -= dy * f;
        continue;
      }
      const w = 2 * nh[nd];
      if (w * w < theta2 * d2) {
        if (d2 < 1) {
          d2 = 1;
        }
        const f = (K * mass) / d2;
        vx -= dx * f;
        vy -= dy * f;
        continue;
      }
      const o = 4 * nd;
      for (let q = 0; q < 4; q++) {
        if (nch[o + q] >= 0) {
          stack[sp++] = nch[o + q];
        }
      }
    }
    this.fx = vx;
    this.fy = vy;
  }
}
