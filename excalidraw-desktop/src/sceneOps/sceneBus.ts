import { getSceneVersion } from "@excalidraw/element";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { getActiveEditor, onActiveEditorChange } from "../editor/editorApi";

export type SceneChange = { reason: "edit" | "switch"; path: string | null };
export type SceneListener = (e: SceneChange) => void;
export type ActiveScene = {
  api: ExcalidrawImperativeAPI;
  path: string | null;
  readOnly: boolean;
};

type Frame = (cb: () => void) => unknown;

/**
 * Scene change notifier. Nothing is attached while there are no listeners;
 * with listeners, one `api.onChange` marks dirty and at most one frame per
 * animation frame compares the scene version, so pan/zoom/selection are free.
 */
export const createSceneBus = (
  getEditor: typeof getActiveEditor = getActiveEditor,
  onEditorChange: typeof onActiveEditorChange = onActiveEditorChange,
  raf: Frame = (cb) => requestAnimationFrame(cb),
) => {
  const listeners = new Set<SceneListener>();
  let detachApi: (() => void) | null = null;
  let detachEditor: (() => void) | null = null;
  let attachedApi: ExcalidrawImperativeAPI | null = null;
  let frameQueued = false;
  let lastDoc: string | null = null;
  let lastVersion = -1;

  const notify = (reason: SceneChange["reason"]) => {
    const path = getEditor()?.path ?? null;
    for (const cb of [...listeners]) {
      try {
        cb({ reason, path });
      } catch {
        // plugin attribution is the caller's guard; isolate here
      }
    }
  };

  const frame = () => {
    frameQueued = false;
    const editor = getEditor();
    if (!editor || listeners.size === 0) {
      return;
    }
    const version = getSceneVersion(
      editor.api.getSceneElementsIncludingDeleted(),
    );
    if (editor.documentId === lastDoc && version === lastVersion) {
      return;
    }
    const reason = editor.documentId === lastDoc ? "edit" : "switch";
    lastDoc = editor.documentId;
    lastVersion = version;
    notify(reason);
  };

  const onApiChange = () => {
    if (!frameQueued) {
      frameQueued = true;
      raf(frame);
    }
  };

  const baseline = () => {
    const editor = getEditor();
    lastDoc = editor?.documentId ?? null;
    lastVersion = editor
      ? getSceneVersion(editor.api.getSceneElementsIncludingDeleted())
      : -1;
  };

  const attach = () => {
    const editor = getEditor();
    if (editor?.api === attachedApi) {
      return;
    }
    detachApi?.();
    detachApi = null;
    attachedApi = editor?.api ?? null;
    if (editor) {
      detachApi = editor.api.onChange(onApiChange);
    }
  };

  const onSwitch = () => {
    attach();
    baseline();
    notify("switch");
  };

  const subscribe = (cb: SceneListener): (() => void) => {
    listeners.add(cb);
    if (listeners.size === 1) {
      attach();
      baseline();
      detachEditor = onEditorChange(onSwitch);
    }
    return () => {
      if (!listeners.delete(cb) || listeners.size > 0) {
        return;
      }
      detachEditor?.();
      detachEditor = null;
      detachApi?.();
      detachApi = null;
      attachedApi = null;
    };
  };

  const getActiveScene = (): ActiveScene | null => {
    const e = getEditor();
    return e ? { api: e.api, path: e.path, readOnly: e.readOnly } : null;
  };

  return {
    subscribeScene: subscribe,
    getActiveScene,
    sceneListenerCount: () => listeners.size,
  };
};

const bus = createSceneBus();
export const subscribeScene = bus.subscribeScene;
export const getActiveScene = bus.getActiveScene;
export const sceneListenerCount = bus.sceneListenerCount;
