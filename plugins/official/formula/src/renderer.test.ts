import {
  __setWorkerFactoryForTests,
  disposeFormulaRenderer,
  renderFormula,
  warmFormulaRenderer,
} from "./renderer";

import type { WorkerIn, WorkerOut } from "./types";

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((e: { data: WorkerOut }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  terminated = false;
  received: WorkerIn[] = [];
  auto = true;
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(msg: WorkerIn) {
    this.received.push(msg);
    if (this.auto) {
      this.reply(msg);
    }
  }
  reply(msg: WorkerIn) {
    queueMicrotask(() =>
      this.onmessage?.({
        data: {
          id: msg.id,
          result:
            "req" in msg
              ? {
                  ok: true,
                  svg: `<svg>${msg.req.source}</svg>`,
                  width: 1,
                  height: 2,
                }
              : null,
        },
      }),
    );
  }
  terminate() {
    this.terminated = true;
  }
}

const req = (source: string) => ({ source, display: false, color: "#000000" });

beforeEach(() => {
  FakeWorker.instances = [];
  __setWorkerFactoryForTests(() => new FakeWorker());
});
afterEach(() => {
  vi.useRealTimers();
  __setWorkerFactoryForTests(null);
});

describe("renderer", () => {
  it("creates no worker until first use, then caches results", async () => {
    expect(FakeWorker.instances).toHaveLength(0);
    const a = await renderFormula(req("x"));
    const b = await renderFormula(req("x"));
    expect(a).toEqual(b);
    expect(a.ok && a.svg).toBe("<svg>x</svg>");
    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0].received).toHaveLength(1);
    await renderFormula({ ...req("x"), display: true });
    expect(FakeWorker.instances[0].received).toHaveLength(2);
  });

  it("evicts least recently used beyond 100 entries", async () => {
    for (let i = 0; i < 101; i++) {
      await renderFormula(req(`f${i}`));
    }
    const w = FakeWorker.instances[0];
    expect(w.received).toHaveLength(101);
    await renderFormula(req("f100"));
    expect(w.received).toHaveLength(101);
    await renderFormula(req("f0"));
    expect(w.received).toHaveLength(102);
  });

  it("warm spawns the worker", async () => {
    warmFormulaRenderer();
    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0].received[0]).toMatchObject({ warm: true });
  });

  it("terminates after 5 min idle and respawns on next use", async () => {
    vi.useFakeTimers();
    await renderFormula(req("a"));
    vi.advanceTimersByTime(4 * 60_000);
    expect(FakeWorker.instances[0].terminated).toBe(false);
    await renderFormula(req("b")); // resets the timer
    vi.advanceTimersByTime(4 * 60_000);
    expect(FakeWorker.instances[0].terminated).toBe(false);
    vi.advanceTimersByTime(61_000);
    expect(FakeWorker.instances[0].terminated).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await renderFormula(req("c"));
    expect(FakeWorker.instances).toHaveLength(2);
  });

  it("never rejects: worker error resolves pending with an error", async () => {
    FakeWorker.instances = [];
    __setWorkerFactoryForTests(() => {
      const w = new FakeWorker();
      w.auto = false;
      return w;
    });
    const p = renderFormula(req("z"));
    FakeWorker.instances[0].onerror?.(new Error("boom"));
    const r = await p;
    expect(r.ok).toBe(false);
    expect(FakeWorker.instances[0].terminated).toBe(true);
    // failures are not cached
    FakeWorker.instances = [];
    __setWorkerFactoryForTests(() => new FakeWorker());
    expect((await renderFormula(req("z"))).ok).toBe(true);
  });

  it("resolves with an error when the worker cannot be created", async () => {
    __setWorkerFactoryForTests(() => {
      throw new Error("no worker");
    });
    const r = await renderFormula(req("q"));
    expect(r).toEqual({ ok: false, error: "no worker" });
  });

  it("dispose resolves pending requests with an error and terminates", async () => {
    __setWorkerFactoryForTests(() => {
      const w = new FakeWorker();
      w.auto = false;
      return w;
    });
    const p = renderFormula(req("p"));
    disposeFormulaRenderer();
    const r = await p;
    expect(r.ok).toBe(false);
    expect(FakeWorker.instances[0].terminated).toBe(true);
  });
});

describe("renderer worker text file", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("answers with an error when the worker text cannot load", async () => {
    vi.stubGlobal("__FORMULA_WORKER_FILE__", "data:text/javascript,throw 1");
    const r = await renderFormula(req("b"));
    expect(r).toEqual({ ok: false, error: "Formula renderer unavailable" });
  });

  it("loads the worker text module on the first render only", async () => {
    vi.stubGlobal(
      "__FORMULA_WORKER_FILE__",
      "data:text/javascript,export default 'w'",
    );
    expect(FakeWorker.instances).toHaveLength(0);
    const r = await renderFormula(req("a"));
    expect(r.ok).toBe(true);
    expect(FakeWorker.instances).toHaveLength(1);
  });
});
