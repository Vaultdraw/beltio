/** Validates a batch and commits it as ONE scene update (one undo step). */
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import {
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

const updated = (
  el: ExcalidrawElement,
  props: Props,
  map: ReadonlyMap<string, ExcalidrawElement>,
): ExcalidrawElement => {
  const { text, ...plain } = props;
  let next = newElementWith(el, plain as never);
  if (text !== undefined && next.type === "text") {
    const patch = refreshTextDimensions(
      next as ExcalidrawTextElement,
      null,
      map as never,
      text,
    );
    next = newElementWith(next, { text, ...patch } as never);
  }
  return next;
};

export const applyOps = (api: SceneApi, ops: unknown): { ids: string[] } => {
  const current = api.getSceneElementsIncludingDeleted();
  const byId = new Map(current.map((e) => [e.id, e]));
  const valid: SceneOp[] = validateOps(ops, byId);

  const adds: NewElement[] = [];
  const edits = new Map<string, ExcalidrawElement | "delete">();
  for (const op of valid) {
    if (op.op === "add") {
      adds.push(op.element);
    } else if (op.op === "delete") {
      edits.set(op.id, "delete");
    } else {
      const base = edits.get(op.id);
      if (base !== "delete") {
        edits.set(op.id, updated(base ?? byId.get(op.id)!, op.props, byId));
      }
    }
  }

  const created = buildElements(adds, viewportCenter(api.getAppState()));
  const merged = current.map((el) => {
    const edit = edits.get(el.id);
    if (!edit) {
      return el;
    }
    return edit === "delete" ? newElementWith(el, { isDeleted: true }) : edit;
  });
  const elements = syncInvalidIndices([...merged, ...created]);
  api.updateScene({
    elements,
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  return { ids: created.filter((e) => !isBound(e)).map((e) => e.id) };
};

const isBound = (e: ExcalidrawElement) =>
  e.type === "text" && !!(e as ExcalidrawTextElement).containerId;
