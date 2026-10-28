/**
 * The TeX renderer service (`ctx.math`). The formula plugin provides the renderer; the notes
 * view and other plugins call it. A tiny store with no imports, so the notes reading view can
 * reach it without loading the plugin host. With no provider (formula plugin off) a render
 * resolves to null and the caller shows the TeX source.
 */
import type { MathRequest, MathResult } from "../../../sdk/api/src/math";

export type MathRenderer = (request: MathRequest) => Promise<MathResult>;

let provider: MathRenderer | null = null;
/** Resolves the callers waiting in renderMath when a provider arrives. */
let waiters: Array<() => void> = [];
/** Starts the formula plugin when it is on (boot sets it); resolves once it had the chance to provide. */
let starter: (() => Promise<void>) | null = null;

export const setMathStarter = (fn: (() => Promise<void>) | null): void => {
  starter = fn;
};

/** Makes `renderer` the provider; the returned function removes it (if it is still the current one). */
export function setMathProvider(renderer: MathRenderer): () => void {
  provider = renderer;
  const pending = waiters;
  waiters = [];
  for (const wake of pending) {
    wake();
  }
  return () => {
    if (provider === renderer) {
      provider = null;
    }
  };
}

export const hasMathProvider = (): boolean => provider !== null;

/** Renders TeX through the provider, starting the formula plugin first when it is on. null: no renderer. */
export async function renderMath(
  request: MathRequest,
): Promise<MathResult | null> {
  if (!provider && starter) {
    try {
      await starter();
    } catch {
      return null;
    }
    // The plugin activates just after its start command runs: wait (at most 2 s) for its provider.
    if (!provider) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, 2000);
        function done() {
          clearTimeout(timer);
          waiters = waiters.filter((w) => w !== done);
          resolve();
        }
        waiters.push(done);
      });
    }
  }
  const render = provider;
  if (!render) {
    return null;
  }
  try {
    return await render(request);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not render formula",
    };
  }
}
