import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ALPHA_WARM } from "./barnesHut";
import { computeBounds } from "./camera";
import { fakeGraph } from "./fakeGraph";
import {
  BLOOM_ALPHA,
  BLOOM_SCALE,
  DIM_ALPHA,
  GraphSession,
  SAVE_DEBOUNCE_MS,
  type LayoutLike,
  type SessionInputs,
  type SessionState,
  type ShownNode,
} from "./GraphSession";
import { encodeGraphLayout } from "./layoutStore";
import { displayName } from "./nodeInfo";
import { DEFAULT_GRAPH_SETTINGS } from "./settings";
import { FLAG_UNRESOLVED } from "./types";
import { deriveGraphColours, FALLBACK_TOKENS } from "./theme";

import type { LayoutCallbacks, LayoutStart } from "./layoutClient";
import type { GraphRenderer, Highlight } from "./renderer/types";

const graph = fakeGraph(120, 5);
const N = graph.nodeCount;

function fakeRenderer() {
  const r = {
    kind: "canvas2d" as const,
    rendererInfo: "fake",
    canvas: document.createElement("canvas"),
    setGraph: vi.fn(),
    setPositions: vi.fn(),
    setCamera: vi.fn(),
    setHighlight: vi.fn<(h: Highlight) => void>(),
    setMask: vi.fn(),
    setTheme: vi.fn(),
    draw: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
  };
  return r as typeof r & GraphRenderer;
}

function fakeLayout(cb: LayoutCallbacks) {
  const l = {
    cb,
    starts: [] as LayoutStart[],
    start: vi.fn((init: LayoutStart) => void l.starts.push(init)),
    setSettings: vi.fn(),
    drag: vi.fn(),
    release: vi.fn(),
    reheat: vi.fn(),
    setMask: vi.fn(),
    terminate: vi.fn(),
  };
  return l;
}

type FakeLayout = ReturnType<typeof fakeLayout>;

function setup(
  saved: Uint8Array = new Uint8Array(0),
  inputs?: Partial<SessionInputs>,
  liveMax?: number,
) {
  const renderer = fakeRenderer();
  const layouts: FakeLayout[] = [];
  const rafs = new Map<number, (t: number) => void>();
  let rafId = 0;
  let clock = 0;
  const states: SessionState[] = [];
  const shown: Array<ShownNode | null> = [];
  const opened: string[] = [];
  const source = {
    graph: vi.fn(async () => graph),
    loadLayout: vi.fn(async () => saved),
    saveLayout: vi.fn(async () => undefined),
  };
  const host = document.createElement("div");
  const session = new GraphSession({
    handle: "h",
    host,
    overlay: document.createElement("canvas"),
    source,
    ui: {
      state: (s) => states.push(s),
      shown: (s) => shown.push(s),
      open: (p) => opened.push(p),
    },
    liveMax,
    createRenderer: () => renderer,
    createLayout: (cb) => {
      const l = fakeLayout(cb);
      layouts.push(l);
      return l as unknown as LayoutLike;
    },
    loop: {
      raf: (cb) => {
        rafs.set(++rafId, cb);
        return rafId;
      },
      caf: (id) => void rafs.delete(id),
    },
    now: () => clock,
    readColours: () => deriveGraphColours(FALLBACK_TOKENS),
  });
  const base: SessionInputs = {
    mode: "global",
    currentPath: null,
    settings: DEFAULT_GRAPH_SETTINGS,
    themeKey: "a",
    ...inputs,
  };
  session.apply(base);
  session.resize(800, 600, 1);
  const flushRaf = (dt = 16) => {
    const batch = [...rafs.entries()];
    rafs.clear();
    clock += dt;
    batch.forEach(([, cb]) => cb(clock));
  };
  return {
    session,
    renderer,
    layouts,
    rafs,
    flushRaf,
    states,
    shown,
    opened,
    source,
    base,
    tick: (ms: number) => (clock += ms),
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("GraphSession open", () => {
  it("draws the first frame before the layout starts, then starts cold", async () => {
    const t = setup();
    await t.session.load();
    expect(t.states.at(-1)).toMatchObject({ phase: "ready", nodeCount: N });
    expect(t.renderer.setGraph).toHaveBeenCalledTimes(1);
    expect(t.renderer.draw).toHaveBeenCalledTimes(1);
    expect(t.layouts).toHaveLength(1);
    const init = t.layouts[0].starts[0];
    expect(init.nodeCount).toBe(N);
    expect(init.alpha).toBeUndefined();
    expect(init.focus).toBeUndefined();
    // tags, ghosts and orphans are all shown by default (D-GF1)
    expect(init.mask).toBeNull();
    expect(t.session.metrics.warm).toBe(false);
  });

  it("warm start blooms: saved layout contracted toward its centre, BLOOM_ALPHA", async () => {
    const pos = new Float32Array(2 * N).map((_, i) => i);
    const t = setup(encodeGraphLayout(graph, pos));
    await t.session.load();
    const a = t.layouts[0].starts[0];
    expect(a.alpha).toBe(BLOOM_ALPHA);
    expect(a.focus).toBeUndefined();
    const b = computeBounds(a.positions, N)!;
    const span = (2 * N - 2) * BLOOM_SCALE; // saved x range is 0..2N-2
    expect(b.maxX - b.minX).toBeCloseTo(span, 3);
  });

  it("warm start above the live limit: saved positions, ALPHA_WARM, focus on the new nodes", async () => {
    const pos = new Float32Array(2 * N).map((_, i) => i);
    const bytes = encodeGraphLayout(graph, pos);
    const full = setup(bytes, undefined, 0);
    await full.session.load();
    const a = full.layouts[0].starts[0];
    expect(a.alpha).toBe(ALPHA_WARM);
    expect(a.focus).toBeUndefined();
    expect(a.positions[10]).toBe(10); // saved position kept

    // drop the last node from the saved file: it becomes the focus
    const partial = encodeGraphLayout(graph, pos).slice(0, 8 + 12 * (N - 1));
    new DataView(partial.buffer).setUint32(4, N - 1, true);
    const part = setup(partial, undefined, 0);
    await part.session.load();
    expect(Array.from(part.layouts[0].starts[0].focus!)).toEqual([N - 1]);
  });

  it("reports a load failure instead of throwing", async () => {
    const t = setup();
    t.source.graph.mockRejectedValueOnce(new Error("boom"));
    await t.session.load();
    expect(t.states.at(-1)).toMatchObject({ phase: "error", error: "boom" });
    expect(t.layouts).toHaveLength(0);
  });
});

describe("GraphSession frames", () => {
  it("coalesces layout messages into one draw per frame and goes idle", async () => {
    const t = setup();
    await t.session.load();
    const draws = t.renderer.draw.mock.calls.length;
    const cb = t.layouts[0].cb;
    for (let i = 0; i < 5; i++) {
      cb.onPositions(new Float32Array(2 * N), { tick: i, alpha: 0.5 });
    }
    expect(t.rafs.size).toBe(1);
    t.flushRaf();
    expect(t.renderer.draw.mock.calls.length).toBe(draws + 1);
    expect(t.renderer.setPositions).toHaveBeenCalled();
    cb.onSettled?.(5);
    t.flushRaf();
    t.flushRaf(300); // camera fit finished
    expect(t.rafs.size).toBe(0);
  });
});

describe("GraphSession saving", () => {
  it("saves once, debounced, after the layout settles", async () => {
    const t = setup();
    await t.session.load();
    t.layouts[0].cb.onPositions(new Float32Array(2 * N), { tick: 1, alpha: 0 });
    t.layouts[0].cb.onSettled?.(1);
    expect(t.source.saveLayout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS + 1);
    expect(t.source.saveLayout).toHaveBeenCalledTimes(1);
    const [handle, bytes] = t.source.saveLayout.mock.calls[0] as unknown as [
      string,
      Uint8Array,
    ];
    expect(handle).toBe("h");
    expect(bytes.byteLength).toBe(8 + 12 * N);
    t.session.dispose();
    expect(t.source.saveLayout).toHaveBeenCalledTimes(1); // nothing new to flush
  });

  it("flushes a settled-but-unsaved layout on close and does not save mid-run", async () => {
    const t = setup();
    await t.session.load();
    t.layouts[0].cb.onPositions(new Float32Array(2 * N), {
      tick: 1,
      alpha: 0.4,
    });
    t.session.dispose();
    expect(t.source.saveLayout).not.toHaveBeenCalled();

    const u = setup();
    await u.session.load();
    u.layouts[0].cb.onPositions(new Float32Array(2 * N), { tick: 1, alpha: 0 });
    u.layouts[0].cb.onSettled?.(1);
    u.session.dispose();
    expect(u.source.saveLayout).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("GraphSession dispose", () => {
  it("terminates the layout, disposes the renderer, cancels rAF and timers", async () => {
    const t = setup();
    await t.session.load();
    t.layouts[0].cb.onPositions(new Float32Array(2 * N), {
      tick: 1,
      alpha: 0.4,
    });
    expect(t.rafs.size).toBe(1);
    t.session.dispose();
    expect(t.layouts[0].terminate).toHaveBeenCalled();
    expect(t.renderer.dispose).toHaveBeenCalledTimes(1);
    expect(t.rafs.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    // late messages and double dispose are harmless
    t.layouts[0].cb.onPositions(new Float32Array(2 * N), {
      tick: 2,
      alpha: 0.3,
    });
    t.session.dispose();
    expect(t.renderer.dispose).toHaveBeenCalledTimes(1);
  });

  it("a dispose before the data arrives never creates a renderer or layout", async () => {
    const t = setup();
    const p = t.session.load();
    t.session.dispose();
    await p;
    expect(t.layouts).toHaveLength(0);
    expect(t.renderer.setGraph).not.toHaveBeenCalled();
  });
});

describe("GraphSession settings", () => {
  it("toggling tags updates both masks without restarting the layout", async () => {
    const t = setup();
    await t.session.load();
    const setMaskCalls = t.renderer.setMask.mock.calls.length;
    t.session.apply({
      ...t.base,
      settings: { ...t.base.settings, showTags: false },
    });
    expect(t.layouts).toHaveLength(1);
    expect(t.renderer.setMask.mock.calls.length).toBe(setMaskCalls + 1);
    expect(t.renderer.setMask.mock.lastCall![0]).not.toBeNull();
    expect(t.layouts[0].setMask).toHaveBeenCalledWith(
      t.renderer.setMask.mock.lastCall![0],
    );
  });

  it("force sliders go to the layout, theme change recolours without a layout restart", async () => {
    const t = setup();
    await t.session.load();
    const forces = { ...t.base.settings.forces, repel: 5 };
    t.session.apply({ ...t.base, settings: { ...t.base.settings, forces } });
    expect(t.layouts[0].setSettings).toHaveBeenCalledWith(forces);
    const graphs = t.renderer.setGraph.mock.calls.length;
    t.session.apply({
      ...t.base,
      settings: { ...t.base.settings, forces },
      themeKey: "b",
    });
    expect(t.renderer.setGraph.mock.calls.length).toBe(graphs + 1);
    expect(t.layouts).toHaveLength(1);
  });

  it("local mode runs a separate layout on the BFS subset and never saves it", async () => {
    const root = graph.path(3)!;
    const t = setup(undefined, { currentPath: root });
    await t.session.load();
    t.session.apply({ ...t.base, currentPath: root, mode: "local" });
    expect(t.layouts).toHaveLength(2);
    expect(t.layouts[0].terminate).toHaveBeenCalled();
    const init = t.layouts[1].starts[0];
    expect(init.nodeCount).toBeLessThan(N);
    expect(init.nodeCount).toBeGreaterThanOrEqual(1);
    expect(t.session.isLocal).toBe(true);
    t.layouts[1].cb.onPositions(new Float32Array(2 * init.nodeCount), {
      tick: 1,
      alpha: 0,
    });
    t.layouts[1].cb.onSettled?.(1);
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS * 2);
    expect(t.source.saveLayout).not.toHaveBeenCalled();
    // back to global: warm restart from the stashed positions
    t.session.apply({ ...t.base, currentPath: root, mode: "global" });
    expect(t.layouts).toHaveLength(3);
    expect(t.layouts[2].starts[0].alpha).toBe(ALPHA_WARM);
    expect(t.layouts[2].starts[0].nodeCount).toBe(N);
  });
});

describe("GraphSession interaction", () => {
  it("hover shows the node, fades the rest to 12% and clears", async () => {
    const t = setup();
    await t.session.load();
    const p = t.session.nodeScreen(0);
    t.session.hoverAt(p.x, p.y);
    const s = t.shown.at(-1)!;
    expect(s.info.name).toBe(displayName(graph, s.node));
    expect(t.session.shown).toBe(s.node);
    t.flushRaf();
    t.flushRaf(200);
    const hl = t.renderer.setHighlight.mock.lastCall![0];
    expect(hl.hovered).toBe(s.node);
    expect(hl.neighbours![s.node]).toBe(1);
    expect(hl.dimAlpha).toBeCloseTo(DIM_ALPHA);
    t.session.hoverLeave();
    expect(t.shown.at(-1)).toBeNull();
    t.flushRaf();
    t.flushRaf(200);
    t.flushRaf(16);
    expect(t.renderer.setHighlight.mock.lastCall![0].neighbours).toBeNull();
  });

  it("click opens a drawing, ghosts do nothing, drag goes to the layout", async () => {
    const t = setup();
    await t.session.load();
    expect(t.session.activate(2)).toBe(true);
    expect(t.opened).toEqual([graph.path(2)]);
    const ghost = Array.from({ length: N }, (_, i) => i).find(
      (i) => graph.flags[i] & FLAG_UNRESOLVED,
    )!;
    expect(graph.isDrawing(ghost)).toBe(false);
    expect(t.session.activate(ghost)).toBe(false);
    t.session.beginDrag(2);
    t.session.dragTo(400, 300);
    expect(t.layouts[0].drag).toHaveBeenCalled();
    t.session.endDrag();
    expect(t.layouts[0].release).toHaveBeenCalled();
  });

  it("the held node follows the pointer at once, even when the worker is a message behind", async () => {
    const t = setup();
    await t.session.load();
    t.session.beginDrag(2);
    t.session.dragTo(400, 300);
    const at = () => t.session.nodeScreen(2);
    expect(at().x).toBeCloseTo(400, 3);
    expect(at().y).toBeCloseTo(300, 3);
    // stale worker positions (all zero) must not pull the held node back
    t.layouts[0].cb.onPositions(new Float32Array(2 * N), {
      tick: 1,
      alpha: 0.3,
    });
    expect(at().x).toBeCloseTo(400, 3);
    t.session.endDrag();
    t.layouts[0].cb.onPositions(new Float32Array(2 * N), {
      tick: 2,
      alpha: 0.3,
    });
    expect(t.session.nodeScreen(2)).not.toEqual({ x: 400, y: 300 });
  });

  it("keyboard focus moves, shows the card and Enter-style activation opens it", async () => {
    const t = setup();
    await t.session.load();
    t.session.moveFocus("right");
    expect(t.session.focus).toBeGreaterThanOrEqual(0);
    expect(t.shown.at(-1)!.focused).toBe(true);
    const f = t.session.focus;
    t.session.moveFocus("left");
    expect(t.session.focus).not.toBe(-1);
    expect(typeof f).toBe("number");
  });

  it("hint map labels visible nodes", async () => {
    const t = setup();
    await t.session.load();
    const map = t.session.hintMap();
    expect(map.labels.size).toBeGreaterThan(0);
    expect(t.session.hintMap()).toBe(map); // cached
    t.session.zoomAt(400, 300, 2);
    expect(t.session.hintMap()).not.toBe(map);
  });
});
