import { describe, expect, it, vi } from "vitest";

import { createSceneBus } from "./sceneBus";

type Fake = {
  documentId: string;
  path: string | null;
  readOnly: boolean;
  api: any;
};

const makeApi = (version = 1) => {
  const state = { version, cb: null as null | (() => void) };
  const api = {
    onChange: vi.fn((cb: () => void) => {
      state.cb = cb;
      return vi.fn(() => {
        if (state.cb === cb) {
          state.cb = null;
        }
      });
    }),
    getSceneElementsIncludingDeleted: () => [
      { version: state.version, versionNonce: 0 },
    ],
  };
  return { api, state };
};

const setup = () => {
  const a = makeApi();
  let editor: Fake | null = {
    documentId: "d1",
    path: "a.excalidraw",
    readOnly: false,
    api: a.api,
  };
  const editorListeners = new Set<() => void>();
  const frames: (() => void)[] = [];
  const raf = vi.fn((cb: () => void) => frames.push(cb));
  const bus = createSceneBus(
    () => editor,
    (cb) => {
      editorListeners.add(cb);
      return () => editorListeners.delete(cb);
    },
    raf,
  );
  const runFrame = () => frames.splice(0).forEach((f) => f());
  const setEditor = (e: Fake | null) => {
    editor = e;
    editorListeners.forEach((cb) => cb());
  };
  return { a, bus, raf, runFrame, setEditor, editorListeners };
};

describe("sceneBus", () => {
  it("attaches nothing without subscribers", () => {
    const { a, raf, bus } = setup();
    expect(a.api.onChange).not.toHaveBeenCalled();
    expect(raf).not.toHaveBeenCalled();
    expect(bus.sceneListenerCount()).toBe(0);
  });

  it("attaches once for the first subscriber", () => {
    const { a, bus } = setup();
    bus.subscribeScene(() => {});
    bus.subscribeScene(() => {});
    expect(a.api.onChange).toHaveBeenCalledTimes(1);
    expect(bus.sceneListenerCount()).toBe(2);
  });

  it("coalesces a burst into one notification per frame", () => {
    const { a, bus, raf, runFrame } = setup();
    const cb = vi.fn();
    bus.subscribeScene(cb);
    a.state.version = 2;
    for (let i = 0; i < 10; i++) {
      a.state.cb!();
    }
    expect(raf).toHaveBeenCalledTimes(1);
    runFrame();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({ reason: "edit", path: "a.excalidraw" });
  });

  it("ignores appState-only changes (same version)", () => {
    const { a, bus, runFrame } = setup();
    const cb = vi.fn();
    bus.subscribeScene(cb);
    a.state.cb!();
    runFrame();
    expect(cb).not.toHaveBeenCalled();
  });

  it("notifies a switch once and re-attaches to the new api", () => {
    const { a, bus, setEditor } = setup();
    const cb = vi.fn();
    bus.subscribeScene(cb);
    const b = makeApi(5);
    setEditor({
      documentId: "d2",
      path: "b.excalidraw",
      readOnly: false,
      api: b.api,
    });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({ reason: "switch", path: "b.excalidraw" });
    expect(b.api.onChange).toHaveBeenCalledTimes(1);
    expect(a.state.cb).toBeNull();
  });

  it("detaches after the last unsubscribe", () => {
    const { a, bus, editorListeners } = setup();
    const off1 = bus.subscribeScene(() => {});
    const off2 = bus.subscribeScene(() => {});
    off1();
    expect(a.state.cb).not.toBeNull();
    off2();
    expect(a.state.cb).toBeNull();
    expect(editorListeners.size).toBe(0);
  });

  it("getActiveScene is null during a swap", () => {
    const { bus, setEditor, a } = setup();
    expect(bus.getActiveScene()?.path).toBe("a.excalidraw");
    setEditor(null);
    expect(bus.getActiveScene()).toBeNull();
    setEditor({
      documentId: "d1",
      path: "a.excalidraw",
      readOnly: true,
      api: a.api,
    });
    expect(bus.getActiveScene()?.readOnly).toBe(true);
  });

  it("a throwing listener does not stop the others", () => {
    const { a, bus, runFrame } = setup();
    const ok = vi.fn();
    bus.subscribeScene(() => {
      throw new Error("x");
    });
    bus.subscribeScene(ok);
    a.state.version = 3;
    a.state.cb!();
    runFrame();
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it("bench: frame cost on 10k elements, one subscriber", () => {
    const elements = Array.from({ length: 10_000 }, () => ({
      version: 1,
      versionNonce: 0,
    }));
    const state = { cb: null as null | (() => void) };
    const api = {
      onChange: (cb: () => void) => {
        state.cb = cb;
        return () => {};
      },
      getSceneElementsIncludingDeleted: () => elements,
    };
    const frames: (() => void)[] = [];
    const bus = createSceneBus(
      () => ({ documentId: "d", path: "p", readOnly: false, api: api as any }),
      () => () => {},
      (cb) => frames.push(cb),
    );
    bus.subscribeScene(() => {});
    const runs = 200;
    const t0 = performance.now();
    for (let i = 0; i < runs; i++) {
      state.cb!();
      frames.splice(0).forEach((f) => f());
    }
    const per = (performance.now() - t0) / runs;
    // eslint-disable-next-line no-console
    console.info(`sceneBus frame @10k elements: ${per.toFixed(4)} ms`);
    expect(per).toBeLessThan(2);
  });
});
