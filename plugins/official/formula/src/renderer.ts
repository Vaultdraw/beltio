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

/**
 * Set by the plugin's build: the module next to main.js whose default export is the worker's
 * bundle as text (the app's CSP allows a worker only from a blob). It loads on the first render,
 * so main.js stays small and a session that never renders math never parses the 3 MB worker text.
 */
declare const __FORMULA_WORKER_FILE__: string | undefined;

let workerSource: string | null = null;

/** Imports the worker text once (plugin build only); a no-op elsewhere. */
const loadWorkerSource = async (): Promise<void> => {
  if (workerSource !== null || typeof __FORMULA_WORKER_FILE__ !== "string") {
    return;
  }
  const file = __FORMULA_WORKER_FILE__;
  workerSource = (
    (await import(/* @vite-ignore */ file)) as { default: string }
  ).default;
};

const defaultFactory = (): WorkerLike => {
  if (workerSource) {
    const url = URL.createObjectURL(
      new Blob([workerSource], { type: "text/javascript" }),
    );
    // The URL is revoked when the worker is terminated: WebKit may fetch the script late.
    const w = new Worker(url);
    const terminate = w.terminate.bind(w);
    w.terminate = () => {
      terminate();
      URL.revokeObjectURL(url);
    };
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

const needsSource = (): boolean =>
  workerSource === null && typeof __FORMULA_WORKER_FILE__ === "string";

const post = (id: number, msg: Omit<WorkerIn, "id">): void => {
  try {
    getWorker().postMessage({ id, ...msg } as WorkerIn);
  } catch (e) {
    const resolve = pending.get(id);
    pending.delete(id);
    terminate("Formula renderer unavailable");
    resolve?.({
      ok: false,
      error: e instanceof Error ? e.message : "Formula renderer unavailable",
    });
  }
};

const send = (msg: Omit<WorkerIn, "id">): Promise<FormulaRender | null> =>
  new Promise((resolve) => {
    clearIdle();
    const id = nextId++;
    pending.set(id, resolve);
    if (worker || !needsSource()) {
      post(id, msg);
      return;
    }
    // First render in the plugin build: load the worker text, then spawn the worker.
    loadWorkerSource().then(
      () => post(id, msg),
      () => {
        pending.delete(id);
        terminate("Formula renderer unavailable");
        resolve({ ok: false, error: "Formula renderer unavailable" });
      },
    );
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
