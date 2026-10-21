/** Wraps every plugin entry point so its errors are attributed, sync or async. */
import { recordHandler } from "./cost";
import { attributeByStack, reportPluginError } from "./errors";

const isThenable = (v: unknown): v is PromiseLike<unknown> =>
  !!v && typeof (v as PromiseLike<unknown>).then === "function";

/**
 * Returns `fn` wrapped: a throw or rejection is reported against `pluginId`
 * and swallowed (the wrapper returns undefined). `timed` records the
 * synchronous duration for the cost panel.
 */
export function guard<A extends unknown[], R>(
  pluginId: string,
  fn: (...args: A) => R,
  where = "callback",
  timed = false,
): (...args: A) => R | undefined {
  return (...args) => {
    const t0 = timed ? performance.now() : 0;
    try {
      const result: unknown = fn(...args);
      if (timed) {
        recordHandler(pluginId, performance.now() - t0);
      }
      if (isThenable(result)) {
        return result.then(undefined, (err) => {
          reportPluginError(pluginId, err, where);
        }) as R;
      }
      return result as R;
    } catch (err) {
      if (timed) {
        recordHandler(pluginId, performance.now() - t0);
      }
      reportPluginError(pluginId, err, where);
      return undefined;
    }
  };
}

let guardsInstalled = 0;
let remove: (() => void) | null = null;

/** Global error listeners; on only while at least one plugin is active. */
export function acquireGlobalGuards(win: Window): void {
  if (guardsInstalled++ > 0) {
    return;
  }
  const onError = (e: ErrorEvent) => {
    const id = attributeByStack(e.error);
    if (id) {
      reportPluginError(id, e.error, "uncaught error");
    }
  };
  const onRejection = (e: PromiseRejectionEvent) => {
    const id = attributeByStack(e.reason);
    if (id) {
      reportPluginError(id, e.reason, "unhandled rejection");
    }
  };
  win.addEventListener("error", onError);
  win.addEventListener("unhandledrejection", onRejection);
  remove = () => {
    win.removeEventListener("error", onError);
    win.removeEventListener("unhandledrejection", onRejection);
  };
}

export function releaseGlobalGuards(): void {
  if (guardsInstalled > 0 && --guardsInstalled === 0) {
    remove?.();
    remove = null;
  }
}

export const globalGuardsActive = (): boolean => guardsInstalled > 0;
