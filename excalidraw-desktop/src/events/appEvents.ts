import type { AppEventMap } from "../../../sdk/api/src/index";

export type { AppEventMap };

export type AppEventName = keyof AppEventMap;

type Listener<K extends AppEventName> = (payload: AppEventMap[K]) => void;

const listeners = new Map<AppEventName, Set<Listener<never>>>();

/**
 * The latest vault and drawing state, kept for plugins that activate after the events fired
 * (startup activation runs on idle, after the first `vault.opened` / `drawing.opened`).
 * One assignment per emit; no queue of past events.
 */
const state: {
  vault?: AppEventMap["vault.opened"];
  drawing?: AppEventMap["drawing.opened"];
} = {};

/**
 * Renames, moves and deletes since the vault opened (at most 100), in order, for plugins that
 * activate later: a favourites list must still follow a rename made before the plugin loaded.
 */
type PathEvent =
  | { name: "drawing.renamed"; payload: AppEventMap["drawing.renamed"] }
  | { name: "drawing.deleted"; payload: AppEventMap["drawing.deleted"] };
const MAX_PATH_EVENTS = 100;
let pathEvents: PathEvent[] = [];

const track = <K extends AppEventName>(name: K, payload: AppEventMap[K]) => {
  if (name === "vault.opened") {
    state.vault = payload as AppEventMap["vault.opened"];
    state.drawing = undefined; // a new vault has no open drawing yet
    pathEvents = [];
  } else if (name === "drawing.opened") {
    state.drawing = payload as AppEventMap["drawing.opened"];
  } else if (name === "drawing.deleted") {
    pathEvents.push({ name, payload } as PathEvent);
    if (pathEvents.length > MAX_PATH_EVENTS) {
      pathEvents.shift();
    }
    if (
      state.drawing?.path === (payload as AppEventMap["drawing.deleted"]).path
    ) {
      state.drawing = undefined;
    }
  } else if (name === "drawing.renamed") {
    const r = payload as AppEventMap["drawing.renamed"];
    pathEvents.push({ name, payload: r });
    if (pathEvents.length > MAX_PATH_EVENTS) {
      pathEvents.shift();
    }
    if (state.drawing?.path === r.from) {
      state.drawing = { path: r.to };
    }
  }
};

/** What a late subscriber to `name` should be told now: the current vault / open drawing, if any. */
const current = <K extends AppEventName>(name: K): AppEventMap[K] | undefined =>
  (name === "vault.opened"
    ? state.vault
    : name === "drawing.opened"
    ? state.drawing
    : undefined) as AppEventMap[K] | undefined;

/** With no listener for `name` this is one Map lookup. A throwing listener never stops the rest. */
const emit = <K extends AppEventName>(name: K, payload: AppEventMap[K]) => {
  track(name, payload);
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

/** The remembered renames or deletes (oldest first) a late subscriber to `name` has not seen. */
const replay = <K extends AppEventName>(name: K): AppEventMap[K][] =>
  pathEvents
    .filter((e) => e.name === name)
    .map((e) => e.payload) as AppEventMap[K][];

/** Forgets the remembered vault and drawing (test kit and vault teardown). */
const clearCurrent = () => {
  state.vault = undefined;
  state.drawing = undefined;
  pathEvents = [];
};

export const appEvents = {
  emit,
  on,
  hasListeners,
  current,
  replay,
  clearCurrent,
};
