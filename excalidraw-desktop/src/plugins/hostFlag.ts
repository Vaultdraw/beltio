/** Tiny store: has the plugin host started? (read by the shell, set by the host) */
let started = false;
const listeners = new Set<() => void>();

export const pluginHostStarted = {
  get: (): boolean => started,
  subscribe: (fn: () => void): (() => void) => {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  },
};

export function markPluginHostStarted(): void {
  started = true;
  listeners.forEach((fn) => fn());
}

/**
 * The quit barrier's plugin step: pending `ctx.storage` writes reach the disk.
 * Free when the host never started (nothing is imported); never throws.
 */
export async function flushPluginData(): Promise<void> {
  if (!started) {
    return;
  }
  try {
    await (await import("./host/storage")).flushAllPluginStorage();
  } catch {
    // A failed write is already logged; quitting must not wait on it.
  }
}
