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
