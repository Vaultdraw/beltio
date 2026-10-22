/**
 * Public scene vocabulary shared by plugins, the control API and the CLI
 * bridge. Additive only. Never exposes version, versionNonce, index, seed,
 * bindings or boundElements.
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

export type SceneElementType =
  | "rectangle"
  | "ellipse"
  | "diamond"
  | "text"
  | "arrow"
  | "line"
  | "freedraw"
  | "image"
  | "frame"
  | "other";

export interface SceneElement {
  readonly id: string;
  readonly type: SceneElementType;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly angle: number;
  readonly text?: string;
  readonly strokeColor?: string;
  readonly backgroundColor?: string;
}

export interface NewElement {
  type: "rectangle" | "ellipse" | "diamond" | "text" | "arrow" | "line";
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  text?: string;
  fontSize?: number;
  strokeColor?: string;
  backgroundColor?: string;
  strokeWidth?: number;
  opacity?: number;
  points?: [number, number][];
}

export type SceneOp =
  | { op: "add"; element: NewElement }
  | { op: "update"; id: string; props: Partial<Omit<NewElement, "type">> }
  | { op: "delete"; id: string };

export interface SceneOpIssue {
  /** Index in the ops array. */
  op: number;
  key?: string;
  message: string;
}

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
