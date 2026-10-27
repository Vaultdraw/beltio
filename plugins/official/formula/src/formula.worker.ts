import { createMathJaxEngine } from "./mathjaxEngine";

import type { FormulaRender, WorkerIn, WorkerOut } from "./types";

type Engine = ReturnType<typeof createMathJaxEngine>;
let engine: Engine | null = null;

const getEngine = () => (engine ??= createMathJaxEngine());

self.onmessage = (e: MessageEvent<WorkerIn>) => {
  const msg = e.data;
  let result: FormulaRender | null = null;
  try {
    const eng = getEngine();
    if ("req" in msg) {
      result = eng.render(msg.req);
    }
  } catch (err) {
    result = {
      ok: false,
      error: err instanceof Error ? err.message : "Formula engine failed",
    };
  }
  const out: WorkerOut = { id: msg.id, result };
  (self as unknown as Worker).postMessage(out);
};
