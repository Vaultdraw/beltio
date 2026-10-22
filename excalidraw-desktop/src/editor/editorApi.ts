import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

/**
 * documentId -> the editor's imperative API while that document's scene is the
 * one shown (history reads it lazily; nothing reads one document's scene
 * under another's id).
 */
const apis = new Map<string, ExcalidrawImperativeAPI>();

/** Live facts about the registered editor, read when asked (a rename never re-registers). */
export type ActiveEditorMeta = () => {
  path: string | null;
  readOnly: boolean;
};

export type ActiveEditor = {
  documentId: string;
  path: string | null;
  api: ExcalidrawImperativeAPI;
  readOnly: boolean;
};

type ActiveEntry = {
  documentId: string;
  api: ExcalidrawImperativeAPI;
  meta?: ActiveEditorMeta;
};

/** The registered editor whose scene is shown (one editor instance per window). */
let active: ActiveEntry | null = null;
const activeListeners = new Set<() => void>();
let notifyQueued = false;

/** One microtask coalesces unregister + register (and bursts) into one notification. */
const notifyActiveChange = () => {
  if (notifyQueued || activeListeners.size === 0) {
    return;
  }
  notifyQueued = true;
  queueMicrotask(() => {
    notifyQueued = false;
    for (const cb of [...activeListeners]) {
      try {
        cb();
      } catch {
        // one failing listener must not starve the others
      }
    }
  });
};

export const registerEditorApi = (
  documentId: string,
  api: ExcalidrawImperativeAPI,
  meta?: ActiveEditorMeta,
): (() => void) => {
  apis.set(documentId, api);
  const entry: ActiveEntry = { documentId, api, meta };
  active = entry;
  notifyActiveChange();
  return () => {
    if (apis.get(documentId) === api) {
      apis.delete(documentId);
    }
    if (active === entry) {
      active = null;
      notifyActiveChange();
    }
  };
};

/** The editor showing a drawing now; null during a scene swap or with no drawing. */
export const getActiveEditor = (): ActiveEditor | null => {
  if (!active) {
    return null;
  }
  const info = active.meta?.();
  return {
    documentId: active.documentId,
    api: active.api,
    path: info?.path ?? null,
    readOnly: info?.readOnly ?? false,
  };
};

/** Fires (coalesced per microtask) when the active editor is (un)registered or switches drawing. */
export const onActiveEditorChange = (cb: () => void): (() => void) => {
  activeListeners.add(cb);
  return () => {
    activeListeners.delete(cb);
  };
};

export const getEditorApi = (
  documentId: string,
): ExcalidrawImperativeAPI | undefined => apis.get(documentId);

/** Mounted editors, whichever document their scene belongs to right now. */
const live = new Set<ExcalidrawImperativeAPI>();

export const registerLiveEditor = (
  api: ExcalidrawImperativeAPI,
): (() => void) => {
  live.add(api);
  return () => {
    live.delete(api);
  };
};

/** Every mounted editor API (e2e harness hook: one entry per live editor, also while it swaps documents). */
export const allEditorApis = (): ExcalidrawImperativeAPI[] => [...live];
