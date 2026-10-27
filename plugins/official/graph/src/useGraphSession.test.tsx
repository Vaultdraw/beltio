import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeGraph } from "./fakeGraph";
import { encodeGraphLayout } from "./layoutStore";
import { DEFAULT_GRAPH_SETTINGS } from "./settings";
import { useGraphSession } from "./useGraphSession";

import type { LayoutCallbacks } from "./layoutClient";

const graph = fakeGraph(80, 2);
const N = graph.nodeCount;

const h = vi.hoisted(() => ({
  renderers: [] as Array<{ dispose: ReturnType<typeof vi.fn> }>,
  layouts: [] as Array<{
    cb: LayoutCallbacks;
    terminate: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock("./renderer/pick", () => ({
  createRenderer: () => {
    const r = {
      kind: "canvas2d",
      rendererInfo: "fake",
      canvas: document.createElement("canvas"),
      setGraph: vi.fn(),
      setPositions: vi.fn(),
      setCamera: vi.fn(),
      setHighlight: vi.fn(),
      setMask: vi.fn(),
      setTheme: vi.fn(),
      draw: vi.fn(),
      resize: vi.fn(),
      dispose: vi.fn(),
    };
    h.renderers.push(r);
    return r;
  },
}));

vi.mock("./layoutClient", () => ({
  LayoutClient: class {
    start = vi.fn();
    setSettings = vi.fn();
    drag = vi.fn();
    release = vi.fn();
    reheat = vi.fn();
    setMask = vi.fn();
    terminate = vi.fn();
    constructor(public cb: LayoutCallbacks) {
      h.layouts.push(this);
    }
  },
}));

class RO {
  observe() {}
  disconnect() {}
}

const inputs = {
  mode: "global" as const,
  currentPath: null,
  settings: DEFAULT_GRAPH_SETTINGS,
  themeKey: "a",
};

function Probe({
  source,
}: {
  source: Parameters<typeof useGraphSession>[0]["source"];
}) {
  const { stageRef, overlayRef, state } = useGraphSession({
    handle: "h",
    source,
    inputs,
    onOpen: () => undefined,
  });
  return (
    <div ref={stageRef} data-phase={state.phase}>
      <canvas ref={overlayRef} />
    </div>
  );
}

beforeEach(() => {
  h.renderers.length = 0;
  h.layouts.length = 0;
  vi.stubGlobal("ResizeObserver", RO);
});
afterEach(() => vi.unstubAllGlobals());

describe("useGraphSession lifecycle", () => {
  it("loads, then on unmount terminates the layout, disposes the renderer and saves a settled layout", async () => {
    const source = {
      graph: vi.fn(async () => graph),
      loadLayout: vi.fn(async () =>
        encodeGraphLayout(graph, new Float32Array(2 * N)),
      ),
      saveLayout: vi.fn(async () => undefined),
    };
    const { container, unmount } = render(<Probe source={source} />);
    await vi.waitFor(() =>
      expect(container.firstElementChild!.getAttribute("data-phase")).toBe(
        "ready",
      ),
    );
    expect(h.renderers).toHaveLength(1);
    expect(h.layouts).toHaveLength(1);
    h.layouts[0].cb.onPositions(new Float32Array(2 * N), { tick: 1, alpha: 0 });
    h.layouts[0].cb.onSettled?.(1);
    unmount();
    expect(h.layouts[0].terminate).toHaveBeenCalled();
    expect(h.renderers[0].dispose).toHaveBeenCalledTimes(1);
    expect(source.saveLayout).toHaveBeenCalledTimes(1);
  });

  it("unmount before the data arrives leaves nothing behind", async () => {
    let release: (g: typeof graph) => void = () => undefined;
    const source = {
      graph: vi.fn(() => new Promise<typeof graph>((r) => (release = r))),
      loadLayout: vi.fn(async () => new Uint8Array(0)),
      saveLayout: vi.fn(async () => undefined),
    };
    const { unmount } = render(<Probe source={source} />);
    unmount();
    release(graph);
    await Promise.resolve();
    await Promise.resolve();
    expect(h.renderers).toHaveLength(0);
    expect(h.layouts).toHaveLength(0);
  });
});
