/**
 * Canvas2D fallback (spike R0 with batching): one path per colour group per alpha class, edges as
 * one path. Used when WebGL2 is missing or software-rendered. At very large edge counts and low
 * zoom the edges are skipped (only the highlighted ones are drawn) to keep frames bounded.
 */
import {
  type ParsedTheme,
  edgeAlpha,
  effectiveDpr,
  nodeZoomFactor,
  parseTheme,
  rgbaCss,
} from "./shared";
import {
  type CameraState,
  type GraphData,
  type GraphRenderer,
  type GraphTheme,
  type Highlight,
  NODE_HOLLOW,
  NODE_RING,
} from "./types";

/** Skip the dense edge layer above this many edges when scale is below `EDGE_SKIP_SCALE`. */
export const EDGE_SKIP_COUNT = 20_000;
export const EDGE_SKIP_SCALE = 0.12;

const TAU = Math.PI * 2;

export class Canvas2DRenderer implements GraphRenderer {
  readonly kind = "canvas2d" as const;
  readonly rendererInfo = "canvas2d";

  private data: GraphData | null = null;
  private pos = new Float32Array(0);
  private mask: Uint8Array | null = null;
  private hl: Highlight = { hovered: -1, neighbours: null, dimAlpha: 1 };
  private cam: CameraState = { x: 0, y: 0, scale: 1 };
  private theme: ParsedTheme = parseTheme({
    background: "#f7f7fa",
    edge: "#8c99b3",
    edgeHighlight: "#3b5bdb",
    label: "#222233",
    accent: "#e8590c",
  });
  private cssW = 1;
  private cssH = 1;
  private dpr = 1;
  private reqDpr = 1;
  /** Plain nodes grouped by colour: `order[start[g]..start[g+1])`, `groupColour[g]`. */
  private order = new Uint32Array(0);
  private groupStart: number[] = [];
  private groupColour: number[] = [];
  private special = new Uint32Array(0);

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly ctx: CanvasRenderingContext2D,
  ) {}

  setGraph(data: GraphData): void {
    this.data = data;
    this.pos = new Float32Array(2 * data.n);
    this.mask = null;
    this.hl = { hovered: -1, neighbours: null, dimAlpha: 1 };
    const byColour = new Map<number, number[]>();
    const special: number[] = [];
    for (let i = 0; i < data.n; i++) {
      if (data.flags && data.flags[i]) {
        special.push(i);
        continue;
      }
      let g = byColour.get(data.colour[i]);
      if (!g) {
        g = [];
        byColour.set(data.colour[i], g);
      }
      g.push(i);
    }
    this.order = new Uint32Array(data.n - special.length);
    this.groupStart = [];
    this.groupColour = [];
    let k = 0;
    for (const [colour, list] of byColour) {
      this.groupStart.push(k);
      this.groupColour.push(colour);
      for (const i of list) {
        this.order[k++] = i;
      }
    }
    this.groupStart.push(k);
    this.special = Uint32Array.from(special);
    this.applyDpr();
  }

  setPositions(p: Float32Array): void {
    this.pos.set(
      p.length === this.pos.length ? p : p.subarray(0, this.pos.length),
    );
  }

  setCamera(c: CameraState): void {
    this.cam.x = c.x;
    this.cam.y = c.y;
    this.cam.scale = c.scale;
  }

  setHighlight(h: Highlight): void {
    this.hl = h;
  }

  setMask(mask: Uint8Array | null): void {
    this.mask = mask;
  }

  setTheme(t: GraphTheme): void {
    this.theme = parseTheme(t);
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    this.cssW = Math.max(1, cssW);
    this.cssH = Math.max(1, cssH);
    this.reqDpr = dpr;
    this.applyDpr();
  }

  private applyDpr(): void {
    this.dpr = effectiveDpr(this.reqDpr, this.data?.n ?? 0);
    const w = Math.max(1, Math.round(this.cssW * this.dpr));
    const h = Math.max(1, Math.round(this.cssH * this.dpr));
    if (this.canvas.width !== w) {
      this.canvas.width = w;
    }
    if (this.canvas.height !== h) {
      this.canvas.height = h;
    }
    this.canvas.style.width = `${this.cssW}px`;
    this.canvas.style.height = `${this.cssH}px`;
  }

  draw(): void {
    const { ctx, data, theme: t, cam, pos, mask } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = rgbaCss(t.background);
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!data || data.n === 0) {
      return;
    }
    const { scale } = cam;
    const W = this.cssW;
    const H = this.cssH;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const ox = W / 2 - cam.x * scale;
    const oy = H / 2 - cam.y * scale;
    const { hovered, neighbours } = this.hl;
    const dimAlpha = neighbours ? this.hl.dimAlpha : 1;
    const m = data.edges.length >> 1;

    // edges (screen space, hairlines)
    const e = data.edges;
    const skipDense = m > EDGE_SKIP_COUNT && scale < EDGE_SKIP_SCALE;
    ctx.lineWidth = 1;
    if (!skipDense) {
      ctx.strokeStyle = rgbaCss(t.edge, edgeAlpha(scale, m) * dimAlpha);
      ctx.beginPath();
      for (let k = 0; k < e.length; k += 2) {
        const a = e[k];
        const b = e[k + 1];
        if (hovered >= 0 && (a === hovered || b === hovered)) {
          continue;
        }
        if (mask && (mask[a] || mask[b])) {
          continue;
        }
        const ax = pos[2 * a] * scale + ox;
        const ay = pos[2 * a + 1] * scale + oy;
        const bx = pos[2 * b] * scale + ox;
        const by = pos[2 * b + 1] * scale + oy;
        if (
          (ax < 0 && bx < 0) ||
          (ay < 0 && by < 0) ||
          (ax > W && bx > W) ||
          (ay > H && by > H)
        ) {
          continue;
        }
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
      }
      ctx.stroke();
    }
    if (hovered >= 0) {
      ctx.strokeStyle = rgbaCss(t.edgeHighlight);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let k = 0; k < e.length; k += 2) {
        const a = e[k];
        const b = e[k + 1];
        if (
          (a === hovered || b === hovered) &&
          !(mask && (mask[a] || mask[b]))
        ) {
          ctx.moveTo(pos[2 * a] * scale + ox, pos[2 * a + 1] * scale + oy);
          ctx.lineTo(pos[2 * b] * scale + ox, pos[2 * b + 1] * scale + oy);
        }
      }
      ctx.stroke();
    }

    // plain nodes: per colour group, bright pass then dim pass
    const zf = nodeZoomFactor(scale);
    const rad = data.radius;
    const passes = neighbours ? 2 : 1;
    for (let pass = 0; pass < passes; pass++) {
      // pass 0: bright (or all), pass 1: dimmed
      ctx.globalAlpha = pass === 0 ? 1 : dimAlpha;
      for (let g = 0; g < this.groupColour.length; g++) {
        const c = this.groupColour[g];
        ctx.fillStyle = `rgba(${c & 255},${(c >>> 8) & 255},${
          (c >>> 16) & 255
        },${(c >>> 24) / 255})`;
        ctx.beginPath();
        let any = false;
        for (let k = this.groupStart[g]; k < this.groupStart[g + 1]; k++) {
          const i = this.order[k];
          if (neighbours && (neighbours[i] ? 0 : 1) !== pass) {
            continue;
          }
          if (mask && mask[i]) {
            continue;
          }
          const x = pos[2 * i] * scale + ox;
          const y = pos[2 * i + 1] * scale + oy;
          const r = rad[i] * zf + 0.5;
          if (x < -r || y < -r || x > W + r || y > H + r) {
            continue;
          }
          ctx.moveTo(x + r, y);
          ctx.arc(x, y, r, 0, TAU);
          any = true;
        }
        if (any) {
          ctx.fill();
        }
      }
    }

    // flagged nodes (hollow unresolved / ringed current): few, drawn one by one
    for (const i of this.special) {
      if (mask && mask[i]) {
        continue;
      }
      const x = pos[2 * i] * scale + ox;
      const y = pos[2 * i + 1] * scale + oy;
      const r = rad[i] * zf + 0.5;
      const f = data.flags ? data.flags[i] : 0;
      const c = data.colour[i];
      const css = `rgba(${c & 255},${(c >>> 8) & 255},${(c >>> 16) & 255},${
        (c >>> 24) / 255
      })`;
      ctx.globalAlpha = neighbours && !neighbours[i] ? dimAlpha : 1;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      if (f & NODE_HOLLOW) {
        ctx.strokeStyle = css;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else {
        ctx.fillStyle = css;
        ctx.fill();
      }
      if (f & NODE_RING) {
        ctx.strokeStyle = rgbaCss(t.accent);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, r + 3, 0, TAU);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  dispose(): void {
    this.data = null;
    this.pos = new Float32Array(0);
    this.canvas.remove();
  }
}
