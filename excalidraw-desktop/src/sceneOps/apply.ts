/** Validates a batch and commits it as ONE scene update (one undo step). */
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { FONT_FAMILY, getSizeFromPoints } from "@excalidraw/common";
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

import {
  applyGroups,
  buildAdds,
  normalAngle,
  roundnessFor,
  withData,
} from "./build";
import { validateOps } from "./validate";
import { viewportCenter } from "./viewport";

import type { BatchResult, NewElement, SceneApi, SceneOp } from "./types";
import type { ValidateOptions } from "./validate";

type Props = Partial<Omit<NewElement, "type" | "start" | "end">>;

/** Options of one batch: the ops limit and the caller's data key. */
export type ApplyOptions = ValidateOptions;

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
  dataKey: string | null,
): ExcalidrawElement => {
  const { text, data, roundness, angle, fontFamily, ...plain } = props;
  const patch: Record<string, unknown> = { ...plain };
  if (props.points && (el.type === "arrow" || el.type === "line")) {
    // The box follows the points (same rule as mutateElement), so bounds, selection and export stay right.
    Object.assign(patch, getSizeFromPoints(props.points as never));
  }
  if (roundness) {
    patch.roundness = roundnessFor(el.type, roundness);
  }
  if (angle !== undefined) {
    patch.angle = normalAngle(angle);
  }
  if (fontFamily) {
    patch.fontFamily = FONT_FAMILY[fontFamily];
  }
  if (data !== undefined && dataKey) {
    patch.customData = withData(el.customData, dataKey, data);
  }
  let next = newElementWith(el, patch as never);
  const relayout =
    text !== undefined ||
    props.fontSize !== undefined ||
    fontFamily !== undefined;
  if (relayout && next.type === "text") {
    const label = next as ExcalidrawTextElement;
    const value = text ?? label.originalText ?? label.text;
    const container = label.containerId
      ? work.get(label.containerId) ?? null
      : null;
    const dims = refreshTextDimensions(
      label,
      container as never,
      work as never,
      value,
    );
    next = newElementWith(next, {
      text: value,
      originalText: value,
      ...dims,
    } as never);
    work.set(next.id, next);
    fitLabel(next as ExcalidrawTextElement, work);
    next = work.get(next.id)!;
  }
  return next;
};

export const applyOps = (
  api: SceneApi,
  ops: unknown,
  options: ApplyOptions = {},
): BatchResult => {
  const current = api.getSceneElementsIncludingDeleted();
  const byId = new Map(current.map((e) => [e.id, e]));
  const valid: SceneOp[] = validateOps(ops, byId, options);
  const dataKey = options.dataKey ?? null;

  const adds: Extract<SceneOp, { op: "add" }>[] = [];
  const groups: Extract<SceneOp, { op: "group" }>[] = [];
  const work: Work = new Map(byId);
  for (const op of valid) {
    if (op.op === "add") {
      adds.push(op);
    } else if (op.op === "group") {
      groups.push(op);
    } else if (op.op === "delete") {
      work.set(op.id, newElementWith(work.get(op.id)!, { isDeleted: true }));
    } else {
      work.set(op.id, updated(work.get(op.id)!, op.props, work, dataKey));
    }
  }

  const { created, ids, refs } = buildAdds(
    adds,
    viewportCenter(api.getAppState()),
    dataKey,
  );
  let fresh = created;
  if (groups.length) {
    for (const el of created) {
      work.set(el.id, el);
    }
    applyGroups(groups, work, refs);
    fresh = created.map((el) => work.get(el.id)!);
  }
  const merged = current.map((el) => work.get(el.id) ?? el);
  const elements = syncInvalidIndices([...merged, ...fresh]);
  api.updateScene({
    elements,
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  return { ids, refs };
};
