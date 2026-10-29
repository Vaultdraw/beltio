/**
 * One open graph: owns the renderer, the layout worker, the camera, hit grid, labels and the
 * hover/search highlight, and wires them together. DOM-free except for the two elements it is
 * given, so the lifecycle is testable with fakes (GraphSession.test.ts).
 *
 * Lifecycle: `load()` fetches graph + saved layout, shows the first frame from saved/seeded
 * positions, then starts the layout (warm with ALPHA_WARM + focus on new nodes, or cold). Each
 * positions message marks the frame dirty; FrameLoop draws at most once per rAF and goes idle
 * after the layout settles. `dispose()` terminates the worker, disposes the renderer, cancels
 * rAF and timers, and flushes an unsaved settled layout.
 */

import { drawArrows } from "./arrows";
import { Camera, computeBounds } from "./camera";
import { ALPHA_WARM, GLOBAL_DRAG_MAX } from "./barnesHut";
import { FrameLoop } from "./frameLoop";
import { HitGrid } from "./hitgrid";
import { LabelLayer } from "./labels";
import {
  nodeColours,
  nodeRadii,
  searchBright,
  visibilityMask,
} from "./filters";
import { describeNode, displayName, type NodeInfo } from "./nodeInfo";
import { selectInDirection, type Direction } from "./keyboard";
import { localGraph } from "./localGraph";
import {
  fnv1a32,
  decodeLayout,
  encodeGraphLayout,
  nodeKey,
  seedPositions,
} from "./layoutStore";
import { NODE_HOLLOW, NODE_RING } from "./renderer/types";
import { parseColour, rgbaCss } from "./renderer/shared";
import {
  deriveGraphColours,
  readGraphTokens,
  type GraphColours,
} from "./theme";
import { FLAG_UNRESOLVED } from "./types";
import { assignNodeHints, visibleHintNodes, type HintMap } from "./hints";

import type { OpenTarget } from "./settings";

import type { FrameLoopDeps } from "./frameLoop";
import type { LayoutCallbacks, LayoutStart } from "./layoutClient";
import type { GraphMode, GraphSettings } from "./settings";
import type { GraphRenderer, GraphTheme } from "./renderer/types";
import type { GraphData } from "./types";

export const DIM_ALPHA = 0.12;
export const DIM_MS = 120;
export const SAVE_DEBOUNCE_MS = 1000;
/** Start alpha of a local graph that begins from the global positions. */
const LOCAL_ALPHA = 0.5;
const FIT_FROM = 0.85;
/**
 * Warm "bloom" (graph-feel D-GF3): a saved layout opens contracted toward its centroid and
 * relaxes back at this alpha, so every open moves like Obsidian. Only up to LIVE_MAX nodes
 * (above it a tick costs more than a frame).
 */
export const BLOOM_SCALE = 0.6;
export const BLOOM_ALPHA = 0.35;
export const LIVE_MAX = GLOBAL_DRAG_MAX;

export interface GraphSource {
  graph(handle: string): Promise<GraphData>;
  loadLayout(handle: string): Promise<Uint8Array>;
  saveLayout(handle: string, bytes: Uint8Array): Promise<void>;
  /**
   * Calls `cb` when drawings or links may have changed (files created, renamed, deleted or saved,
   * in the app or outside); returns the unsubscribe. The open graph refreshes (hunter C-5).
   */
  onChange?(cb: () => void): () => void;
}

export interface LayoutLike {
  start(init: LayoutStart): void;
  setSettings(s: Partial<GraphSettings["forces"]>): void;
  drag(node: number, x: number, y: number): void;
  release(): void;
  reheat(alpha?: number): void;
  setMask(mask: Uint8Array | null): void;
  terminate(): void;
}

export interface SessionInputs {
  mode: GraphMode;
  currentPath: string | null;
  settings: GraphSettings;
  themeKey: string;
}

export interface ShownNode {
  /** View index (what the renderer and layout use). */
  node: number;
  info: NodeInfo;
  /** Screen position (CSS px, relative to the stage) of the node centre. */
  x: number;
  y: number;
  /** Whether keyboard focus (true) or the pointer (false) put it here. */
  focused: boolean;
}

export interface SessionState {
  phase: "loading" | "ready" | "error";
  nodeCount: number;
  backend?: string;
  error?: string;
}

export interface SessionUi {
  shown(s: ShownNode | null): void;
  state(s: SessionState): void;
  open(path: string, target?: OpenTarget): void;
}

export interface SessionDeps {
  handle: string;
  host: HTMLElement;
  overlay: HTMLCanvasElement;
  source: GraphSource;
  ui: SessionUi;
  createRenderer: (host: HTMLElement) => GraphRenderer;
  createLayout: (cb: LayoutCallbacks) => LayoutLike;
  loop?: FrameLoopDeps;
  now?: () => number;
  readColours?: (host: HTMLElement) => GraphColours;
  /** Largest view that blooms on a warm open (default LIVE_MAX). */
  liveMax?: number;
}

export interface SessionMetrics {
  /** ms from construction to graph + layout bytes in hand. */
  dataMs: number;
  /** ms from construction to the first full frame drawn. */
  firstFrameMs: number;
  settledMs: number;
  layoutMessages: number;
  frames: number;
  warm: boolean;
  backend: string;
  /** CPU ms of the last renders (render + labels), newest last. */
  frameTimes: number[];
}

const FRAME_RING = 240;

export class GraphSession {
  readonly metrics: SessionMetrics = {
    dataMs: 0,
    firstFrameMs: 0,
    settledMs: 0,
    layoutMessages: 0,
    frames: 0,
    warm: false,
    backend: "",
    frameTimes: [],
  };

  private readonly now: () => number;
  private readonly t0: number;
  private readonly loop: FrameLoop;
  private readonly camera = new Camera();
  private readonly grid = new HitGrid();
  private readonly labels: LabelLayer;
  private readonly ctx: CanvasRenderingContext2D | null;

  private renderer: GraphRenderer | null = null;
  private layout: LayoutLike | null = null;
  private epoch = 0;
  private disposed = false;
  private loaded = false;
  private inputs: SessionInputs | null = null;
  private colours!: GraphColours;
  private dpr = 1;
  private width = 1;
  private height = 1;

  private g!: GraphData;
  private hadSaved = false;
  private isNew: Uint8Array | null = null;
  /** Global layout positions (stash while a local graph is shown). */
  private gpos!: Float32Array;
  private local = false;
  private viewIds: Uint32Array | null = null;
  private localOf: Int32Array | null = null;
  private vn = 0;
  private viewEdges: Uint32Array = new Uint32Array(0);
  private pos: Float32Array = new Float32Array(0);
  private radius: Float32Array = new Float32Array(0);
  private mask: Uint8Array | null = null;
  private searchMask: Uint8Array | null = null;
  private pathIndex: Map<string, number> | null = null;

  private posDirty = false;
  private gridDirty = true;
  private touched = false;
  private settledOnce = false;
  private unsaved = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private cold = false;

  // hover / focus
  /** Time of the previous render (label fades need the frame step). */
  private lastRenderAt = 0;
  private hovered = -1;
  private focused = -1;
  private shownNode = -1;
  private hoverMask: Uint8Array | null = null;
  private hoverNeighbours: Uint32Array = new Uint32Array(0);
  private dimAlpha = 1;
  private dimFrom = 1;
  private dimTo = 1;
  private dimT0 = 0;
  private dimming = false;
  private fitWasAnimating = false;
  private dragging = -1;
  private dragX = 0;
  private dragY = 0;
  private hintCache: { key: string; map: HintMap } | null = null;
  private viewVersion = 0;

  constructor(private readonly d: SessionDeps) {
    this.now = d.now ?? (() => performance.now());
    this.t0 = this.now();
    this.ctx = d.overlay.getContext("2d");
    this.labels = new LabelLayer({
      label: (i) => displayName(this.g, this.gid(i)),
    });
    this.loop = new FrameLoop((t) => this.render(t), d.loop);
  }

  // ---- public API --------------------------------------------------------------------------

  /** Latest props. Before `load()` finishes they are only remembered. */
  apply(next: SessionInputs): void {
    const prev = this.inputs;
    this.inputs = next;
    if (this.loaded && prev && !this.disposed) {
      this.reconcile(prev, next);
    }
  }

  resize(w: number, h: number, dpr: number): void {
    if (this.disposed) {
      return;
    }
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    this.dpr = Math.min(2, dpr > 0 ? dpr : 1);
    this.camera.setViewport(this.width, this.height);
    const o = this.d.overlay;
    o.width = Math.round(this.width * this.dpr);
    o.height = Math.round(this.height * this.dpr);
    o.style.width = `${this.width}px`;
    o.style.height = `${this.height}px`;
    this.renderer?.resize(this.width, this.height, dpr);
    this.loop.invalidate();
  }

  async load(): Promise<void> {
    const { source, handle, ui } = this.d;
    ui.state({ phase: "loading", nodeCount: 0 });
    try {
      const [g, bytes] = await Promise.all([
        source.graph(handle),
        source.loadLayout(handle).catch(() => new Uint8Array(0)),
      ]);
      if (this.disposed) {
        return;
      }
      this.metrics.dataMs = this.now() - this.t0;
      this.g = g;
      const saved = decodeLayout(bytes);
      this.hadSaved = saved.size > 0;
      this.metrics.warm = this.hadSaved;
      this.gpos = seedPositions(g, saved);
      if (this.hadSaved) {
        const fresh = new Uint8Array(g.nodeCount);
        let any = false;
        for (let i = 0; i < g.nodeCount; i++) {
          if (!saved.has(fnv1a32(nodeKey(g, i)))) {
            fresh[i] = 1;
            any = true;
          }
        }
        this.isNew = any ? fresh : null;
      }
      const inputs = this.inputs;
      if (!inputs) {
        throw new Error("graph: apply() must run before load()");
      }
      this.colours = this.readColours();
      this.renderer = this.d.createRenderer(this.d.host);
      this.metrics.backend = this.renderer.rendererInfo;
      this.renderer.resize(this.width, this.height, this.dpr);
      this.loaded = true;
      this.cold = !this.hadSaved;
      this.buildView(true);
      this.drawNow();
      this.metrics.firstFrameMs = this.now() - this.t0;
      ui.state({
        phase: "ready",
        nodeCount: this.vn,
        backend: this.renderer.rendererInfo,
      });
    } catch (e) {
      if (!this.disposed) {
        ui.state({
          phase: "error",
          nodeCount: 0,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  /**
   * Re-reads the graph after files changed, keeping every node that stays where it is (its
   * position carries over by path); new nodes are seeded next to their links and the layout
   * runs warm, so the picture settles instead of starting over (Obsidian's live graph).
   */
  async refresh(): Promise<void> {
    if (!this.loaded || this.disposed) {
      return;
    }
    const { source, handle, ui } = this.d;
    let g: GraphData;
    try {
      g = await source.graph(handle);
    } catch {
      return; // keep showing the last good graph
    }
    if (this.disposed) {
      return;
    }
    const current =
      !this.local && this.pos.length === this.gpos.length
        ? this.pos
        : this.gpos;
    const kept = decodeLayout(encodeGraphLayout(this.g, current));
    this.g = g;
    this.gpos = seedPositions(g, kept);
    this.isNew = null;
    this.buildView(false);
    this.drawNow();
    ui.state({
      phase: "ready",
      nodeCount: this.vn,
      backend: this.renderer?.rendererInfo,
    });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.flushSave();
    this.disposed = true;
    this.epoch++;
    this.layout?.terminate();
    this.layout = null;
    this.loop.dispose();
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.renderer?.dispose();
    this.renderer = null;
  }

  get nodeCount(): number {
    return this.vn;
  }

  get isLocal(): boolean {
    return this.local;
  }

  get scale(): number {
    return this.camera.scale;
  }

  // ---- view construction -------------------------------------------------------------------

  private gid(i: number): number {
    return this.viewIds ? this.viewIds[i] : i;
  }

  private readColours(): GraphColours {
    return (
      this.d.readColours?.(this.d.host) ??
      deriveGraphColours(readGraphTokens(this.d.host))
    );
  }

  private rootOf(path: string | null): number {
    if (!path) {
      return -1;
    }
    if (!this.pathIndex) {
      this.pathIndex = new Map();
      for (let i = 0; i < this.g.nodeCount; i++) {
        const p = this.g.path(i);
        if (p) {
          this.pathIndex.set(p, i);
        }
      }
    }
    return this.pathIndex.get(path) ?? -1;
  }

  /** Builds the view arrays for the current inputs and presents them (no layout yet). */
  private buildView(first: boolean): void {
    const inp = this.inputs!;
    const g = this.g;
    if (!this.local && this.pos.length === this.gpos.length && this.vn) {
      this.gpos = this.pos.slice(); // leaving a global run: keep its positions
    }
    const root = inp.mode === "local" ? this.rootOf(inp.currentPath) : -1;
    this.local = root >= 0;
    if (this.local) {
      const lg = localGraph(
        g.adjacency(),
        g.edges,
        root,
        inp.settings.localDepth,
      );
      this.viewIds = lg.nodes;
      this.localOf = new Int32Array(g.nodeCount).fill(-1);
      lg.nodes.forEach((id, k) => (this.localOf![id] = k));
      this.viewEdges = lg.edges;
      this.vn = lg.nodes.length;
      this.pos = new Float32Array(2 * this.vn);
      for (let k = 0; k < this.vn; k++) {
        this.pos[2 * k] = this.gpos[2 * lg.nodes[k]];
        this.pos[2 * k + 1] = this.gpos[2 * lg.nodes[k] + 1];
      }
    } else {
      this.viewIds = null;
      this.localOf = null;
      this.viewEdges = g.edges;
      this.vn = g.nodeCount;
      this.pos = this.gpos.slice();
    }
    this.hovered = this.focused = this.shownNode = -1;
    this.hoverMask = null;
    this.hintCache = null;
    this.d.ui.shown(null);
    this.labels.setGraph(this.vn, this.degreeOf());
    this.labels.fadeScale = inp.settings.textFade;
    this.labels.font = this.colours.font;
    this.mask = visibilityMask(g, inp.settings, this.viewIds);
    this.pushNodes(inp);
    this.searchMask = searchBright(g, inp.settings.search, this.viewIds);
    const r = this.renderer!;
    r.setMask(this.mask);
    r.setTheme(this.rendererTheme(inp.settings));
    r.setPositions(this.pos);
    this.grid.build(this.pos, this.radius, this.vn, this.mask);
    this.gridDirty = false;
    this.settledOnce = false;
    this.fit(first || this.local, first);
    this.startLayout(first);
    this.viewVersion++;
  }

  private degreeOf(): Uint32Array {
    const out = new Uint32Array(this.vn);
    for (let i = 0; i < this.vn; i++) {
      const id = this.gid(i);
      out[i] = this.g.outDeg[id] + this.g.inDeg[id];
    }
    return out;
  }

  /** (Re)uploads radius, colour and flags. */
  private pushNodes(inp: SessionInputs): void {
    const g = this.g;
    this.radius = nodeRadii(g, inp.settings.nodeSize, this.viewIds);
    const colour = nodeColours(
      g,
      inp.settings,
      this.colours.palette,
      this.viewIds,
    );
    const flags = new Uint8Array(this.vn);
    const cur = inp.currentPath ? this.rootOf(inp.currentPath) : -1;
    for (let i = 0; i < this.vn; i++) {
      const id = this.gid(i);
      if (g.flags[id] & FLAG_UNRESOLVED) {
        flags[i] |= NODE_HOLLOW;
      }
      if (id === cur) {
        flags[i] |= NODE_RING;
      }
    }
    this.renderer!.setGraph({
      n: this.vn,
      edges: this.viewEdges,
      radius: this.radius,
      colour,
      flags,
    });
    this.renderer!.setMask(this.mask);
    this.renderer!.setPositions(this.pos);
    this.grid.build(this.pos, this.radius, this.vn, this.mask);
    this.gridDirty = false;
  }

  private rendererTheme(s: GraphSettings): GraphTheme {
    const t = this.colours.theme;
    const e = parseColour(t.edge);
    // Edges are GPU hairlines: "link thickness" scales their opacity.
    e[3] = Math.min(1, 0.7 * s.linkThickness);
    return { ...t, edge: rgbaCss(e) };
  }

  private startLayout(first: boolean): void {
    this.layout?.terminate();
    const epoch = ++this.epoch;
    const s = this.inputs!.settings;
    const layout = this.d.createLayout({
      onPositions: (p) => {
        if (epoch !== this.epoch || this.disposed) {
          return;
        }
        this.metrics.layoutMessages++;
        this.pos.set(p);
        if (this.dragging >= 0) {
          // the worker is a message behind the pointer: keep the held node under it
          this.pos[2 * this.dragging] = this.dragX;
          this.pos[2 * this.dragging + 1] = this.dragY;
        }
        this.posDirty = true;
        this.gridDirty = true;
        this.unsaved = false;
        this.settledOnce = false;
        this.loop.invalidate();
      },
      onSettled: () => {
        if (epoch === this.epoch && !this.disposed) {
          this.onSettled();
        }
      },
    });
    this.layout = layout;
    const mask = this.mask ? this.mask.slice() : null;
    const init: LayoutStart = {
      nodeCount: this.vn,
      edges: this.viewEdges.slice(),
      positions: this.pos.slice(),
      settings: s.forces,
      mask,
    };
    if (this.local) {
      init.alpha = LOCAL_ALPHA;
    } else if (
      first &&
      this.hadSaved &&
      this.vn <= (this.d.liveMax ?? LIVE_MAX)
    ) {
      this.bloom();
      init.positions = this.pos.slice();
      init.alpha = BLOOM_ALPHA;
    } else if (this.hadSaved || !first) {
      init.alpha = ALPHA_WARM;
      if (first && this.isNew) {
        const ids: number[] = [];
        this.isNew.forEach((v, i) => v && ids.push(i));
        init.focus = Uint32Array.from(ids);
      }
    }
    layout.start(init);
  }

  /** Contracts the visible nodes toward their centroid (start of the warm bloom). */
  private bloom(): void {
    const b = computeBounds(this.pos, this.vn, this.mask);
    if (!b) {
      return;
    }
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const P = this.pos;
    for (let i = 0; i < this.vn; i++) {
      P[2 * i] = cx + (P[2 * i] - cx) * BLOOM_SCALE;
      P[2 * i + 1] = cy + (P[2 * i + 1] - cy) * BLOOM_SCALE;
    }
    this.renderer!.setPositions(P);
    this.gridDirty = true;
  }

  private onSettled(): void {
    this.settledOnce = true;
    this.gridDirty = true;
    this.metrics.settledMs = this.now() - this.t0;
    if (this.cold && !this.touched) {
      this.fit(true, false);
    }
    this.cold = false;
    if (!this.local) {
      this.unsaved = true;
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
      }
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null;
        this.flushSave();
      }, SAVE_DEBOUNCE_MS);
    }
    this.loop.invalidate();
  }

  private flushSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (!this.unsaved || this.local || !this.loaded) {
      return;
    }
    this.unsaved = false;
    const bytes = encodeGraphLayout(this.g, this.pos);
    void this.d.source.saveLayout(this.d.handle, bytes).catch(() => undefined);
  }

  // ---- reconcile ---------------------------------------------------------------------------

  private reconcile(prev: SessionInputs, next: SessionInputs): void {
    const a = prev.settings;
    const b = next.settings;
    const viewChanged =
      prev.mode !== next.mode ||
      (next.mode === "local" &&
        (prev.currentPath !== next.currentPath ||
          a.localDepth !== b.localDepth));
    if (prev.themeKey !== next.themeKey) {
      this.colours = this.readColours();
      this.labels.font = this.colours.font;
    }
    if (viewChanged) {
      this.flushSave();
      this.touched = false;
      this.cold = next.mode === "local";
      this.buildView(false);
      this.loop.invalidate();
      return;
    }
    const recolour =
      prev.themeKey !== next.themeKey ||
      a.colourBy !== b.colourBy ||
      a.groups !== b.groups ||
      a.nodeSize !== b.nodeSize ||
      prev.currentPath !== next.currentPath;
    const maskChanged =
      a.showTags !== b.showTags ||
      a.showUnresolved !== b.showUnresolved ||
      a.showOrphans !== b.showOrphans;
    if (maskChanged) {
      this.mask = visibilityMask(this.g, b, this.viewIds);
      this.layout?.setMask(this.mask ? this.mask.slice() : null);
      this.gridDirty = true;
    }
    if (a.search !== b.search) {
      this.searchMask = searchBright(this.g, b.search, this.viewIds);
      this.startDim(this.activeMask() ? DIM_ALPHA : 1);
    }
    if (recolour) {
      this.pushNodes(next);
    } else if (maskChanged) {
      this.renderer!.setMask(this.mask);
    }
    if (recolour || a.linkThickness !== b.linkThickness) {
      this.renderer!.setTheme(this.rendererTheme(b));
    }
    if (a.forces !== b.forces) {
      this.settledOnce = false;
      this.layout?.setSettings(b.forces);
    }
    this.labels.fadeScale = b.textFade;
    this.viewVersion++;
    this.hintCache = null;
    this.loop.invalidate();
  }

  // ---- camera ------------------------------------------------------------------------------

  fit(animate = true, fromOut = false): void {
    const b = computeBounds(this.pos, this.vn, this.mask);
    if (!b) {
      return;
    }
    if (fromOut) {
      this.camera.fit(b, 40, false);
      this.camera.scale *= FIT_FROM;
    }
    this.camera.fit(b, 40, animate, this.now());
    this.loop.invalidate();
  }

  userFit(): void {
    this.touched = true;
    this.fit(true, false);
  }

  panBy(dx: number, dy: number): void {
    this.touched = true;
    this.camera.panBy(dx, dy);
    this.cameraMoved();
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    this.touched = true;
    this.camera.zoomAt(sx, sy, factor);
    this.cameraMoved();
  }

  /** Smooth (eased, cursor-anchored) zoom for wheel/pinch/keyboard; settles via render(). */
  zoomSmooth(sx: number, sy: number, factor: number): void {
    this.touched = true;
    this.camera.zoomSmooth(sx, sy, factor);
    this.cameraMoved();
  }

  zoomCentre(factor: number): void {
    this.zoomSmooth(this.width / 2, this.height / 2, factor);
  }

  /** Inertial pan glide after a background drag release (screen px/ms). */
  fling(vx: number, vy: number): void {
    this.touched = true;
    this.camera.fling(vx, vy);
    this.cameraMoved();
  }

  /** Stops any glide/ease (new pointerdown). */
  stopMotion(): void {
    this.camera.cancelMotion();
  }

  /** Called from render() while the camera moves by itself, so hint/hover caches follow. */
  private cameraStepped(): void {
    this.viewVersion++;
    this.hintCache = null;
  }

  private cameraMoved(): void {
    this.viewVersion++;
    this.hintCache = null;
    this.loop.invalidate();
  }

  // ---- picking, hover, focus ---------------------------------------------------------------

  private ensureGrid(): void {
    if (this.gridDirty) {
      this.grid.build(this.pos, this.radius, this.vn, this.mask);
      this.gridDirty = false;
    }
  }

  pickScreen(sx: number, sy: number): number {
    this.ensureGrid();
    const w = this.camera.screenToWorld(sx, sy);
    return this.grid.pick(w.x, w.y, this.camera.scale);
  }

  hoverAt(sx: number, sy: number): void {
    const n = this.dragging >= 0 ? this.dragging : this.pickScreen(sx, sy);
    if (n !== this.hovered) {
      this.hovered = n;
      this.refreshShown();
    }
  }

  hoverLeave(): void {
    if (this.hovered >= 0) {
      this.hovered = -1;
      this.refreshShown();
    }
  }

  get shown(): number {
    return this.shownNode;
  }

  get focus(): number {
    return this.focused;
  }

  viewNeighbours(i: number): number[] {
    const raw = this.g.neighbours(this.gid(i));
    if (!this.localOf) {
      return Array.from(raw);
    }
    const out: number[] = [];
    for (const j of raw) {
      const v = this.localOf[j];
      if (v >= 0) {
        out.push(v);
      }
    }
    return out;
  }

  private activeMask(): Uint8Array | null {
    return this.hoverMask ?? this.searchMask;
  }

  private startDim(to: number): void {
    if (to === this.dimTo && this.dimming) {
      return;
    }
    this.dimFrom = this.dimAlpha;
    this.dimTo = to;
    this.dimT0 = this.now();
    this.dimming = true;
    this.loop.invalidate();
  }

  private refreshShown(): void {
    const next = this.hovered >= 0 ? this.hovered : this.focused;
    if (next === this.shownNode) {
      return;
    }
    this.shownNode = next;
    if (next >= 0) {
      const nb = this.viewNeighbours(next);
      const m = new Uint8Array(this.vn);
      m[next] = 1;
      for (const j of nb) {
        m[j] = 1;
      }
      this.hoverMask = m;
      this.hoverNeighbours = Uint32Array.from(nb);
      this.startDim(DIM_ALPHA);
    } else {
      this.hoverNeighbours = new Uint32Array(0);
      // keep the mask while fading out; render() drops it when the fade ends
      this.startDim(this.searchMask ? DIM_ALPHA : 1);
      if (this.searchMask) {
        this.hoverMask = null;
      }
    }
    this.notifyShown();
    this.loop.invalidate();
  }

  private notifyShown(): void {
    const i = this.shownNode;
    if (i < 0) {
      this.d.ui.shown(null);
      return;
    }
    const p = this.camera.worldToScreen(this.pos[2 * i], this.pos[2 * i + 1]);
    this.d.ui.shown({
      node: i,
      info: describeNode(this.g, this.gid(i)),
      x: p.x,
      y: p.y,
      focused: this.hovered < 0,
    });
  }

  setFocus(i: number): void {
    this.focused = i;
    this.hovered = -1;
    this.shownNode = -2; // force refresh
    this.refreshShown();
    if (i >= 0) {
      this.ensureOnScreen(i);
    }
  }

  private ensureOnScreen(i: number): void {
    const p = this.camera.worldToScreen(this.pos[2 * i], this.pos[2 * i + 1]);
    const m = 40;
    if (p.x < m || p.y < m || p.x > this.width - m || p.y > this.height - m) {
      this.camera.animateTo(
        {
          x: this.pos[2 * i],
          y: this.pos[2 * i + 1],
          scale: this.camera.scale,
        },
        this.now(),
      );
      this.touched = true;
      this.viewVersion++;
      this.hintCache = null;
      this.loop.invalidate();
    }
  }

  moveFocus(dir: Direction): void {
    const c = this.camera;
    const next = selectInDirection(
      this.pos,
      this.vn,
      this.focused,
      dir,
      this.focused >= 0 ? this.viewNeighbours(this.focused) : [],
      this.mask,
      { x: c.x, y: c.y },
    );
    if (next >= 0) {
      this.setFocus(next);
    }
  }

  /** Path of a view node when it is a drawing. */
  pathOf(i: number): string | null {
    return i >= 0 ? this.g.path(this.gid(i)) : null;
  }

  /** Opens a drawing node (ghosts and tags do nothing). Returns whether it opened. */
  activate(i: number, target?: OpenTarget): boolean {
    const path = this.pathOf(i);
    if (!path) {
      return false;
    }
    this.d.ui.open(path, target);
    return true;
  }

  // ---- hints -------------------------------------------------------------------------------

  /** Hint letters of the currently visible nodes (cached until the view moves). */
  hintMap(chars?: string): HintMap {
    const key = `${this.viewVersion}|${chars ?? ""}`;
    if (this.hintCache?.key === key) {
      return this.hintCache.map;
    }
    const ids = visibleHintNodes({
      positions: this.pos,
      n: this.vn,
      camera: this.camera,
      width: this.width,
      height: this.height,
      mask: this.mask,
      degree: (i) => this.g.outDeg[this.gid(i)] + this.g.inDeg[this.gid(i)],
    });
    const map = assignNodeHints(ids, chars);
    this.hintCache = { key, map };
    return map;
  }

  nodeScreen(i: number): { x: number; y: number } {
    return this.camera.worldToScreen(this.pos[2 * i], this.pos[2 * i + 1]);
  }

  // ---- drag --------------------------------------------------------------------------------

  beginDrag(i: number): void {
    this.dragging = i;
    this.touched = true;
  }

  dragTo(sx: number, sy: number): void {
    if (this.dragging < 0) {
      return;
    }
    const w = this.camera.screenToWorld(sx, sy);
    const i = this.dragging;
    this.dragX = this.pos[2 * i] = w.x;
    this.dragY = this.pos[2 * i + 1] = w.y;
    this.posDirty = true;
    this.loop.invalidate();
    this.layout?.drag(i, w.x, w.y);
  }

  endDrag(): void {
    if (this.dragging >= 0) {
      this.dragging = -1;
      this.layout?.release();
      this.gridDirty = true;
    }
  }

  // ---- rendering ---------------------------------------------------------------------------

  private drawNow(): void {
    this.render(this.now());
  }

  private render(now: number): boolean {
    const r = this.renderer;
    if (!r || this.disposed) {
      return false;
    }
    const t = this.now();
    let again = false;
    const animating = this.camera.step(now);
    if (animating) {
      again = true;
      this.fitWasAnimating = true;
      this.cameraStepped();
    } else if (this.fitWasAnimating) {
      this.fitWasAnimating = false;
      this.cameraStepped();
      if (this.shownNode >= 0) {
        this.notifyShown();
      }
    }
    if (this.dimming) {
      const k = Math.min(1, (now - this.dimT0) / DIM_MS);
      this.dimAlpha = this.dimFrom + (this.dimTo - this.dimFrom) * k;
      if (k >= 1) {
        this.dimming = false;
        if (this.dimTo >= 1 && this.shownNode < 0) {
          this.hoverMask = null;
        }
      } else {
        again = true;
      }
    }
    if (this.posDirty) {
      r.setPositions(this.pos);
      this.posDirty = false;
    }
    const mask = this.activeMask();
    r.setCamera(this.camera);
    r.setHighlight({
      hovered: this.shownNode,
      neighbours: mask,
      dimAlpha: this.dimAlpha,
    });
    r.draw();
    const dtMs = this.lastRenderAt > 0 ? now - this.lastRenderAt : undefined;
    this.lastRenderAt = now;
    if (this.drawOverlay(dtMs)) {
      again = true; // a label is still fading
    }
    this.metrics.frames++;
    const ft = this.metrics.frameTimes;
    ft.push(this.now() - t);
    if (ft.length > FRAME_RING) {
      ft.shift();
    }
    return again;
  }

  /** Largest per-frame opacity step of any label since `resetLabelStats` (tests: no blinking). */
  labelWorstStep(): number {
    return this.labels.worstStep;
  }
  resetLabelStats(): void {
    this.labels.worstStep = 0;
  }

  /** Draws labels and arrows; true while a label is still fading (needs another frame). */
  private drawOverlay(dtMs?: number): boolean {
    const ctx = this.ctx;
    if (!ctx) {
      return false;
    }
    const frame = {
      positions: this.pos,
      camera: this.camera,
      width: this.width,
      height: this.height,
      mask: this.mask,
      hovered: this.shownNode,
      always: this.hoverNeighbours,
      dtMs,
    };
    this.labels.draw(ctx, frame, this.colours.theme.label, this.dpr);
    const s = this.inputs?.settings;
    if (s?.arrows) {
      drawArrows(
        ctx,
        {
          edges: this.viewEdges,
          positions: this.pos,
          radius: this.radius,
          camera: this.camera,
          width: this.width,
          height: this.height,
          mask: this.mask,
        },
        this.colours.theme.edgeHighlight,
      );
    }
    return this.labels.animating;
  }
}
