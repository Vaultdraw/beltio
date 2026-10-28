/** Validates a batch and commits it as ONE scene update (one undo step). */
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import {
  isPageModeOn,
  PAGE_LIMITS,
} from "@excalidraw/excalidraw/data/pageSetup";
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
import type { AppState } from "@excalidraw/excalidraw/types";

import { getPageSetupPatch } from "../page/pageSetupChange";

import { buildBatch, normalAngle, roundnessFor, withData } from "./build";
import { planImages } from "./images";
import { validateOps } from "./validate";
import { viewportCenter } from "./viewport";

import type { BatchResult, NewElement, SceneApi, SceneOp } from "./types";
import type { ImageHashes } from "./images";
import type { ValidateOptions } from "./validate";

type Props = Partial<Omit<NewElement, "type" | "start" | "end">>;

/** Options of one batch: the ops limit and the caller's data key. */
export type ApplyOptions = ValidateOptions & {
  /** From `hashImages(ops)`; needed when the batch adds images. */
  images?: ImageHashes;
  /** Page mode: the page count to set in the same undo step (clamped to the page limit). */
  pageCount?: number;
  /** Scroll the first added element to the top-centre of the view (not in page mode). */
  reveal?: boolean;
};

/** Distance of a revealed element's top edge from the view's top, in screen pixels. */
const REVEAL_TOP_MARGIN = 24;

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
  fileId?: string,
): ExcalidrawElement => {
  const { text, data, roundness, angle, fontFamily, image, ...plain } = props;
  const patch: Record<string, unknown> = { ...plain };
  if (plain.name === "") {
    // An empty title brings back the editor's own "Frame N".
    patch.name = null;
  }
  if (image && fileId && el.type === "image") {
    // A new picture on the same element: id, z-order, groups, bindings and locks stay.
    patch.fileId = fileId;
    patch.status = "saved";
  }
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
  const valid: SceneOp[] = validateOps(ops, byId, {
    ...options,
    allowImages: options.images !== undefined,
  });
  const dataKey = options.dataKey ?? null;
  const imagePlan = planImages(api, valid, options.images);

  const work: Work = new Map(byId);
  for (const op of valid) {
    if (op.op === "delete") {
      work.set(op.id, newElementWith(work.get(op.id)!, { isDeleted: true }));
    } else if (op.op === "update") {
      work.set(
        op.id,
        updated(
          work.get(op.id)!,
          op.props,
          work,
          dataKey,
          imagePlan?.fileIds.get(op) as string | undefined,
        ),
      );
    }
  }

  const {
    created: fresh,
    ids,
    refs,
  } = buildBatch(
    valid,
    viewportCenter(api.getAppState()),
    dataKey,
    work,
    imagePlan?.fileIds,
  );
  const merged = current.map((el) => work.get(el.id) ?? el);
  const elements = syncInvalidIndices([...merged, ...fresh]);
  if (imagePlan?.files.length) {
    api.addFiles(imagePlan.files);
  }
  const appState = api.getAppState();
  const pageCount =
    options.pageCount !== undefined && isPageModeOn(appState.pageSetup)
      ? Math.min(PAGE_LIMITS.pageCount.max, Math.max(1, options.pageCount))
      : undefined;
  const first = options.reveal
    ? fresh.find((el) => el.id === ids[0])
    : undefined;
  const revealPatch =
    first && !isPageModeOn(appState.pageSetup)
      ? {
          scrollX:
            appState.width / (2 * appState.zoom.value) -
            (first.x + first.width / 2),
          scrollY: REVEAL_TOP_MARGIN / appState.zoom.value - first.y,
        }
      : undefined;
  // updateScene infers one Pick<AppState, K>; the patch is one of two kinds
  const patch = (
    pageCount !== undefined
      ? getPageSetupPatch(appState, { pageCount })
      : revealPatch
  ) as Pick<AppState, "pageSetup"> | undefined;
  api.updateScene({
    elements,
    ...(patch ? { appState: patch } : {}),
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  return { ids, refs };
};
