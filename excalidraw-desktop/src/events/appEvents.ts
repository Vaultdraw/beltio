/** Typed app events for plugins. Paths are vault-relative, never absolute. */
export type AppEventMap = {
  "vault.opened": { name: string };
  "drawing.opened": { path: string };
  "drawing.saved": { path: string };
  "drawing.renamed": { from: string; to: string };
  "drawing.deleted": { path: string };
};

export type AppEventName = keyof AppEventMap;

type Listener<K extends AppEventName> = (payload: AppEventMap[K]) => void;

const listeners = new Map<AppEventName, Set<Listener<never>>>();

/** With no listener for `name` this is one Map lookup. A throwing listener never stops the rest. */
const emit = <K extends AppEventName>(name: K, payload: AppEventMap[K]) => {
  const set = listeners.get(name);
  if (!set) {
    return;
  }
  for (const cb of [...set] as Listener<K>[]) {
    try {
      cb(payload);
    } catch {
      // plugin attribution is the subscriber's guard; the bus only isolates
    }
  }
};

const on = <K extends AppEventName>(name: K, cb: Listener<K>): (() => void) => {
  let set = listeners.get(name);
  if (!set) {
    set = new Set();
    listeners.set(name, set);
  }
  set.add(cb as Listener<never>);
  return () => {
    const current = listeners.get(name);
    if (current?.delete(cb as Listener<never>) && current.size === 0) {
      listeners.delete(name);
    }
  };
};

const hasListeners = (name: AppEventName): boolean => listeners.has(name);

export const appEvents = { emit, on, hasListeners };
