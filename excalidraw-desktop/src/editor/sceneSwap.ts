/**
 * Pure rules for loading another document into a live editor (no React, no
 * DOM): which scene may be saved, how a loaded file becomes the editor's
 * app state, and which in-flight swap is still wanted.
 */
import { loadFromJSONText } from "@excalidraw/excalidraw";

import type {
  AppState,
  BinaryFiles,
  NormalizedZoomValue,
} from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { baseStyleAppState } from "../toolDefaults/baseStyle";
import { getPreferences } from "../vault/preferences";

import { takeSpeculativeScene } from "../speculative/speculativeOpen";

import { exportOptionsToAppState, loadExportOptions } from "./exportOptions";

export type SceneView = { scrollX: number; scrollY: number; zoom: number };

export type LoadedScene = {
  elements: readonly ExcalidrawElement[];
  appState: Partial<AppState>;
  files: BinaryFiles;
};

/**
 * The scene on screen belongs to the document the props name. False between
 * the props changing and the swap landing: nothing the editor reports then
 * may be saved (the save callback already points at the new document).
 */
export const isSceneCurrent = (
  sceneDocId: string | null,
  propDocId: string,
): boolean => sceneDocId !== null && sceneDocId === propDocId;

/** A scene is loaded but the props already name another document. */
export const isSwapping = (
  sceneDocId: string | null,
  propDocId: string,
): boolean => sceneDocId !== null && sceneDocId !== propDocId;

/** App state of a file as the editor opens it: export options, no file handle, restored view. */
export const withDocumentAppState = (
  appState: Partial<AppState>,
  view: SceneView | undefined,
): Partial<AppState> => ({
  ...appState,
  ...exportOptionsToAppState(loadExportOptions()),
  // saved currentItem* never wins: base = [editor] over built-ins
  ...baseStyleAppState(getPreferences()),
  fileHandle: null,
  ...(view && {
    scrollX: view.scrollX,
    scrollY: view.scrollY,
    zoom: { value: view.zoom as NormalizedZoomValue },
  }),
});

/**
 * Parses saved JSON the way a fresh editor does (restore, migrations, files).
 * Yields one task first: callers start it from the click's commit, and the
 * parse must not delay that frame (the old Blob read was async too).
 */
export const loadScene = async (
  json: string,
  view: SceneView | undefined,
): Promise<LoadedScene> => {
  // parsed ahead on pointer-down (speculative/): only the app state is left to do
  const ahead = await takeSpeculativeScene(json);
  if (ahead) {
    return {
      elements: ahead.elements,
      appState: withDocumentAppState(ahead.appState, view),
      files: ahead.files,
    };
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  const scene = loadFromJSONText(json, null, null);
  return {
    elements: scene.elements,
    appState: withDocumentAppState(scene.appState, view),
    files: scene.files,
  };
};

/** What the host owns, not the document: kept across a swap. */
const HOST_KEYS = ["theme", "openSidebar", "viewModeEnabled", "toast"] as const;

/**
 * A complete app state for the incoming document. `loaded` carries every
 * persisted key (restore fills defaults), so selection, open dialogs and
 * menus, text editing, tool and the like all return to their defaults; only
 * the host's own keys come from the live state. Mirrors the editor's own
 * initial-data handling (preferred selection tool, no stale loading flag).
 */
export const swapAppState = (
  loaded: Partial<AppState>,
  live: Pick<AppState, typeof HOST_KEYS[number] | "preferredSelectionTool">,
): Partial<AppState> => {
  const preferredSelectionTool = live.preferredSelectionTool?.initialized
    ? live.preferredSelectionTool
    : { type: "selection" as const, initialized: true };
  const tool = loaded.activeTool;
  const keepsSelectionTool =
    !tool ||
    tool.type === "image" ||
    tool.type === "lasso" ||
    tool.type === "selection";
  const next: Partial<AppState> = {
    ...loaded,
    preferredSelectionTool,
    isLoading: false,
  };
  if (tool && keepsSelectionTool) {
    next.activeTool = { ...tool, type: preferredSelectionTool.type };
  }
  for (const key of HOST_KEYS) {
    (next as Record<string, unknown>)[key] = live[key];
  }
  return next;
};

/** Resolves with `work`, or after `ms` whichever is first (never rejects). */
export const raceTimeout = (
  work: Promise<unknown>,
  ms: number,
): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    work.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        resolve();
      },
    );
  });
