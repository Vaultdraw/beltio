/**
 * Scene vocabulary. The public types live in `sdk/api` (re-exported here);
 * the error class and the editor seam below are internal to the app.
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

export type {
  BatchResult,
  ElementRef,
  NewElement,
  SceneElementDetail,
  SceneElement,
  SceneElementType,
  SceneOp,
  SceneOpIssue,
} from "../../../sdk/api/src/index";

/** Thrown before anything is written; lists every problem found. */
export { SceneOpsError } from "../../../sdk/api/testing/sceneRules";

/** The adapter seam: the only editor surface the core touches. */
export type SceneApi = Pick<
  ExcalidrawImperativeAPI,
  "getAppState" | "getSceneElementsIncludingDeleted" | "updateScene"
>;
