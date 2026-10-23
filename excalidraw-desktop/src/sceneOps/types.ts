/**
 * Scene vocabulary. The public types live in `sdk/api` (re-exported here);
 * the error class and the editor seam below are internal to the app.
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import type { SceneOpIssue } from "../../../sdk/api/src/index";

export type {
  NewElement,
  SceneElement,
  SceneElementType,
  SceneOp,
  SceneOpIssue,
} from "../../../sdk/api/src/index";

/** Thrown before anything is written; lists every problem found. */
export class SceneOpsError extends Error {
  readonly issues: SceneOpIssue[];

  constructor(issues: SceneOpIssue[]) {
    super(
      issues
        .map((i) => `op ${i.op}${i.key ? ` (${i.key})` : ""}: ${i.message}`)
        .join("; "),
    );
    this.name = "SceneOpsError";
    this.issues = issues;
  }
}

/** The adapter seam: the only editor surface the core touches. */
export type SceneApi = Pick<
  ExcalidrawImperativeAPI,
  "getAppState" | "getSceneElementsIncludingDeleted" | "updateScene"
>;
