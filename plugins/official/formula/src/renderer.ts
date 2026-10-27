// Main-thread client for the formula worker. The worker (and MathJax inside it)
// is created on first use only; never import mathjaxEngine from here.
import type {
  FormulaRender,
  FormulaRequest,
  WorkerIn,
  WorkerOut,
} from "./types";

const CACHE_SIZE = 100;
const IDLE_MS = 5 * 60_000;

type WorkerLike = {
  postMessage(msg: WorkerIn): void;
  terminate(): void;
  onmessage: ((e: { data: WorkerOut }) => void) | null;
  onerror: ((e: unknown) => void) | null;
};

/** The worker's bundle, injected by the plugin's build (the app's CSP allows a worker only from a blob). */
declare const __FORMULA_WORKER_SOURCE__: string | undefined;

const defaultFactory = (): WorkerLike => {
  if (
    typeof __FORMULA_WORKER_SOURCE__ === "string" &&
    __FORMULA_WORKER_SOURCE__
  ) {
    const url = URL.createObjectURL(
      new Blob([__FORMULA_WORKER_SOURCE__], { type: "text/javascript" }),
    );
    const w = new Worker(url);
    URL.revokeObjectURL(url);
    return w as unknown as WorkerLike;
  }
  // Outside the plugin build (the app's end-to-end run, built by Vite).
  return new Worker(new URL("./formula.worker.ts", import.meta.url), {
    type: "module",
  }) as unknown as WorkerLike;
};

let factory: () => WorkerLike = defaultFactory;
let worker: WorkerLike | null = null;
let nextId = 1;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
const pending = new Map<number, (r: FormulaRender | null) => void>();
const cache = new Map<string, FormulaRender>();

const clearIdle = () => {
  if (idleTimer !== null) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
};

const failAll = (error: string) => {
  const waiting = [...pending.values()];
  pending.clear();
  waiting.forEach((resolve) => resolve({ ok: false, error }));
};

const terminate = (error: string) => {
  clearIdle();
  const w = worker;
  worker = null;
  if (w) {
    w.onmessage = null;
    w.onerror = null;
    w.terminate();
  }
  failAll(error);
};

const armIdle = () => {
  clearIdle();
  if (pending.size === 0 && worker) {
    idleTimer = setTimeout(() => {
      idleTimer = null;
      terminate("Formula renderer stopped");
    }, IDLE_MS);
  }
};

const getWorker = (): WorkerLike => {
  if (worker) {
    return worker;
  }
  const w = factory();
  w.onmessage = (e) => {
    const resolve = pending.get(e.data.id);
    if (resolve) {
      pending.delete(e.data.id);
      resolve(e.data.result);
    }
    armIdle();
  };
  w.onerror = () => {
    if (worker === w) {
      terminate("Formula renderer crashed");
    }
  };
  worker = w;
  return w;
};

const send = (msg: Omit<WorkerIn, "id">): Promise<FormulaRender | null> =>
  new Promise((resolve) => {
    clearIdle();
    const id = nextId++;
    pending.set(id, resolve);
    try {
      getWorker().postMessage({ id, ...msg } as WorkerIn);
    } catch (e) {
      pending.delete(id);
      terminate("Formula renderer unavailable");
      resolve({
        ok: false,
        error: e instanceof Error ? e.message : "Formula renderer unavailable",
      });
    }
  });

export async function renderFormula(
  req: FormulaRequest,
): Promise<FormulaRender> {
  const key = JSON.stringify([req.source, req.display, req.color]);
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const result = (await send({ req })) ?? { ok: false, error: "No result" };
  if (result.ok) {
    cache.set(key, result);
    if (cache.size > CACHE_SIZE) {
      cache.delete(cache.keys().next().value as string);
    }
  }
  return result;
}

/** Spawn the worker and load MathJax ahead of the first render. */
export function warmFormulaRenderer(): void {
  void send({ warm: true });
}

export function disposeFormulaRenderer(): void {
  terminate("Formula renderer disposed");
  cache.clear();
}

export function __setWorkerFactoryForTests(f: (() => WorkerLike) | null): void {
  disposeFormulaRenderer();
  factory = f ?? defaultFactory;
}
