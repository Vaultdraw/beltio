import { useLayoutEffect, useRef } from "react";
import { flushSync } from "react-dom";

import { clearElementCanvasCache } from "@excalidraw/element";
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { Fonts } from "@excalidraw/excalidraw/fonts/Fonts";

import type {
  AppState,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";

import { markOpen } from "../perf/openMarks";

import { blockEditorInput } from "./inputGuard";
import { loadScene, raceTimeout, swapAppState } from "./sceneSwap";

import type { LoadedScene, SceneView } from "./sceneSwap";

import type { RefObject } from "react";

/** The scene is parsed and its fonts/images ready within this, or it lands anyway. */
const PRELOAD_TIMEOUT_MS = 2000;

export type SceneSwapRestore = {
  view?: SceneView;
  takeUndo(): unknown;
};

export type SceneSwapDeps = {
  /** The document the props name. */
  documentId: string;
  /** The document whose scene the editor shows; null until the first load. */
  loadedDocId: string | null;
  host: RefObject<HTMLElement | null>;
  getApi(): ExcalidrawImperativeAPI | null;
  getSource(): { readonly json: string };
  getRestore(): SceneSwapRestore | undefined;
  /** The shown scene stops being saveable (called before anything async). */
  begin(): void;
  /** Inside the landing step, before the new scene is applied. */
  beforeApply(source: string): void;
  /**
   * Inside the landing step's `flushSync`, right after the new scene is
   * applied: state updates here join the scene's commit (one commit per open).
   * Nothing that reads the committed editor state belongs here.
   */
  landing(documentId: string): void;
  /** Right after the landing commit (same task): refs and baselines. */
  afterApply(api: ExcalidrawImperativeAPI, documentId: string): void;
  /** Anything went wrong: the caller falls back to a full remount. */
  fail(cause: unknown): void;
};

const preload = async (
  api: ExcalidrawImperativeAPI,
  scene: LoadedScene,
  doc: Document,
) => {
  const images = api.addFiles(Object.values(scene.files));
  const fonts = Fonts.loadElementsFonts(scene.elements, doc)
    // the landing renders the new scene with these faces: a later
    // `loadingdone` for them must not redraw it again
    .then(Fonts.markFontFacesProcessed)
    .catch(() => {});
  await Promise.all([images, fonts]);
};

/**
 * Reuses one editor for many documents. When `documentId` changes: the
 * shown scene stops being saveable and input is blocked; the new source is
 * parsed and its fonts and images are made ready while the old scene stays
 * on screen; then one synchronous step swaps files, history, elements and
 * app state (one commit, one paint). A newer `documentId` abandons a swap.
 */
export function useSceneSwap(deps: SceneSwapDeps): void {
  const live = useRef(deps);
  live.current = deps;
  const { documentId, loadedDocId } = deps;

  useLayoutEffect(() => {
    if (loadedDocId === null || loadedDocId === documentId) {
      return;
    }
    const l = live.current;
    const hostEl = l.host.current;
    const doc = hostEl?.ownerDocument;
    const win = doc?.defaultView;
    let cancelled = false;
    // set inside the landing flush: from then on this swap's own errors must
    // still fall back, although the flush already ran the cleanup
    let landed = false;
    l.begin();
    if (!hostEl || !doc || !win) {
      l.fail(new Error("Editor window is not mounted"));
      return;
    }
    const unblock = blockEditorInput(hostEl);
    const json = l.getSource().json;
    const restore = l.getRestore();

    const run = async () => {
      const api = l.getApi();
      if (!api || api.isDestroyed) {
        throw new Error("Editor is not ready");
      }
      markOpen("parse");
      const scene = await loadScene(json, restore?.view);
      markOpen("parsed");
      if (cancelled) {
        return;
      }
      await raceTimeout(preload(api, scene, doc), PRELOAD_TIMEOUT_MS);
      markOpen("preloaded");
      if (cancelled) {
        return;
      }
      flushSync(() => {
        l.beforeApply(json);
        // the old drawing's element bitmaps would otherwise wait for the idle trim
        clearElementCanvasCache();
        api.retainFiles(Object.keys(scene.files));
        api.history.clear();
        api.setElementRenderOverrides(null);
        // the undo baseline starts from the new scene (otherwise it keeps
        // every earlier drawing's elements as deleted copies, growing with
        // each swap)
        api.clearScene();
        api.updateScene({
          elements: scene.elements,
          appState: swapAppState(scene.appState, api.getAppState()) as AppState,
          captureUpdate: CaptureUpdateAction.NEVER,
        });
        // `loadedDocId` flips in this commit, so this effect's cleanup runs
        // inside the flush (`cancelled`, `unblock`); `landed` keeps the
        // failure path for the steps below.
        landed = true;
        l.landing(documentId);
      });
      markOpen("landed");
      l.afterApply(api, documentId);
      const undo = restore?.takeUndo();
      if (undo) {
        api.history.import(undo as Parameters<typeof api.history.import>[0]);
      }
      unblock();
    };

    run().catch((cause) => {
      if (!cancelled || landed) {
        unblock();
        l.fail(cause);
      }
    });
    return () => {
      cancelled = true;
      unblock();
    };
  }, [documentId, loadedDocId]);
}
