/** Validates a batch and commits it as ONE scene update (one undo step). */
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { getSizeFromPoints } from "@excalidraw/common";
import {
  computeBoundTextPosition,
  computeContainerDimensionForBoundText,
  getBoundTextMaxHeight,
  getBoundTextMaxWidth,
  isArrowElement,
  isStickyNoteElement,
  newElementWith,
  refreshTextDimensions,
  syncInvalidIndices,
} from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

import { buildElements } from "./build";
import { validateOps } from "./validate";
import { viewportCenter } from "./viewport";

import type { NewElement, SceneApi, SceneOp } from "./types";

type Props = Partial<Omit<NewElement, "type">>;

/** Working copy of the scene: ops are applied to it in order, so later ops see earlier ones. */
type Work = Map<string, ExcalidrawElement>;

/** A label that outgrew its container makes the container grow (arrows and sticky notes lay out on their own). */
const fitLabel = (label: ExcalidrawTextElement, work: Work): void => {
  const container = label.containerId ? work.get(label.containerId) : undefined;
  if (!container || container.isDeleted) {
    return;
  }
  if (isArrowElement(container) || isStickyNoteElement(container)) {
    return;
  }
  const grow: { width?: number; height?: number } = {};
  if (label.height > getBoundTextMaxHeight(container, label as never)) {
    grow.height = computeContainerDimensionForBoundText(
      label.height,
      container.type as never,
    );
  }
  if (label.width > getBoundTextMaxWidth(container, label)) {
    grow.width = computeContainerDimensionForBoundText(
      label.width,
      container.type as never,
    );
  }
  const fitted = Object.keys(grow).length
    ? newElementWith(container, grow)
    : container;
  if (fitted !== container) {
    work.set(container.id, fitted);
  }
  const pos = computeBoundTextPosition(fitted, label as never, work as never);
  work.set(label.id, newElementWith(label, pos));
};

const updated = (
  el: ExcalidrawElement,
  props: Props,
  work: Work,
): ExcalidrawElement => {
  const { text, ...plain } = props;
  const patch: Record<string, unknown> = { ...plain };
  if (props.points && (el.type === "arrow" || el.type === "line")) {
    // The box follows the points (same rule as mutateElement), so bounds, selection and export stay right.
    Object.assign(patch, getSizeFromPoints(props.points as never));
  }
  let next = newElementWith(el, patch as never);
  if (text !== undefined && next.type === "text") {
    const label = next as ExcalidrawTextElement;
    const container = label.containerId
      ? work.get(label.containerId) ?? null
      : null;
    const dims = refreshTextDimensions(
      label,
      container as never,
      work as never,
      text,
    );
    next = newElementWith(next, {
      text,
      originalText: text,
      ...dims,
    } as never);
    work.set(next.id, next);
    fitLabel(next as ExcalidrawTextElement, work);
    next = work.get(next.id)!;
  }
  return next;
};

export const applyOps = (api: SceneApi, ops: unknown): { ids: string[] } => {
  const current = api.getSceneElementsIncludingDeleted();
  const byId = new Map(current.map((e) => [e.id, e]));
  const valid: SceneOp[] = validateOps(ops, byId);

  const adds: NewElement[] = [];
  const work: Work = new Map(byId);
  for (const op of valid) {
    if (op.op === "add") {
      adds.push(op.element);
    } else if (op.op === "delete") {
      work.set(op.id, newElementWith(work.get(op.id)!, { isDeleted: true }));
    } else {
      work.set(op.id, updated(work.get(op.id)!, op.props, work));
    }
  }

  const created = buildElements(adds, viewportCenter(api.getAppState()));
  const merged = current.map((el) => work.get(el.id) ?? el);
  const elements = syncInvalidIndices([...merged, ...created]);
  api.updateScene({
    elements,
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  return { ids: created.filter((e) => !isBound(e)).map((e) => e.id) };
};

const isBound = (e: ExcalidrawElement) =>
  e.type === "text" && !!(e as ExcalidrawTextElement).containerId;
