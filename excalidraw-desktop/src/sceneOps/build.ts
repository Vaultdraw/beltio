/**
 * Turns validated adds into real elements with fresh ids, through Excalidraw's
 * own converter (labels, arrow bindings). We pick the ids ourselves
 * (`regenerateIds: false`), so a batch's refs map exactly to ids. Groups and
 * plugin data are added after the build (the converter has neither).
 */
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import {
  FONT_FAMILY,
  getSizeFromPoints,
  randomId,
  ROUNDNESS,
} from "@excalidraw/common";
import {
  bindBindingElement,
  computeBoundTextPosition,
  elementCenterPoint,
  getBindingGap,
  getCommonBounds,
  intersectElementWithLineSegment,
  isUsingAdaptiveRadius,
  newElementWith,
  Scene,
} from "@excalidraw/element";
import {
  lineSegment,
  pointDistanceSq,
  pointFrom,
  type GlobalPoint,
  type LocalPoint,
} from "@excalidraw/math";

import type { ExcalidrawElementSkeleton } from "@excalidraw/element/transform";
import type {
  ExcalidrawArrowElement,
  ExcalidrawBindableElement,
  ExcalidrawElement,
  ExcalidrawTextElementWithContainer,
  NonDeleted,
} from "@excalidraw/element/types";

import type { NewElement, SceneOp } from "./types";

const CONTAINERS = new Set(["rectangle", "ellipse", "diamond", "arrow"]);
const TURN = 2 * Math.PI;

type AddOp = Extract<SceneOp, { op: "add" }>;
type GroupOp = Extract<SceneOp, { op: "group" }>;

/** Editor value of a public roundness name for an element type. */
export const roundnessFor = (
  type: string,
  name: "sharp" | "round",
): ExcalidrawElement["roundness"] =>
  name === "sharp"
    ? null
    : {
        type: isUsingAdaptiveRadius(type)
          ? ROUNDNESS.ADAPTIVE_RADIUS
          : ROUNDNESS.PROPORTIONAL_RADIUS,
      };

/** Angle in 0..2π, as the editor stores it. */
export const normalAngle = (a: number) => ((a % TURN) + TURN) % TURN;

/** customData with this plugin's `data` set (or removed for null). */
export const withData = (
  customData: Record<string, unknown> | undefined,
  key: string,
  data: unknown,
): Record<string, unknown> | undefined => {
  const next = { ...customData };
  if (data === null) {
    delete next[key];
  } else {
    next[key] = data;
  }
  return Object.keys(next).length ? next : undefined;
};

const toSkeleton = (
  e: NewElement,
  id: string,
  dataKey: string | null,
): ExcalidrawElementSkeleton => {
  const {
    text,
    points,
    fontFamily,
    fontSize,
    roundness,
    angle,
    data,
    start,
    end,
    ...rest
  } = e;
  const sk: Record<string, unknown> = {
    ...rest,
    id,
    x: e.x ?? 0,
    y: e.y ?? 0,
  };
  const family = fontFamily ? FONT_FAMILY[fontFamily] : undefined;
  if (e.type === "text") {
    sk.text = text ?? "";
    if (fontSize !== undefined) {
      sk.fontSize = fontSize;
    }
    if (family !== undefined) {
      sk.fontFamily = family;
    }
  } else if (text && CONTAINERS.has(e.type)) {
    // A container's text is its bound label.
    sk.label = {
      text,
      ...(fontSize !== undefined ? { fontSize } : {}),
      ...(family !== undefined ? { fontFamily: family } : {}),
    };
  }
  if (roundness) {
    sk.roundness = roundnessFor(e.type, roundness);
  }
  if (angle !== undefined) {
    sk.angle = normalAngle(angle);
  }
  if (data !== undefined && data !== null && dataKey) {
    sk.customData = { [dataKey]: data };
  }
  // start/end are bound after the build (bindArrows): the converter binds but
  // does not move the arrow onto the shapes.
  void start;
  void end;
  if (e.type === "line" || e.type === "arrow") {
    if (points) {
      sk.points = points;
      // A linear element's box follows its points; an explicit size would fight it.
      delete sk.width;
      delete sk.height;
    }
  }
  return sk as unknown as ExcalidrawElementSkeleton;
};

const ZOOM = { value: 1 } as never;

const nearest = (points: GlobalPoint[], to: GlobalPoint) =>
  points.sort((a, b) => pointDistanceSq(a, to) - pointDistanceSq(b, to))[0];

/** Where a straight line from `el`'s centre towards `to` leaves its outline (plus the binding gap). */
const outlinePoint = (
  el: ExcalidrawElement,
  to: GlobalPoint,
  map: ReturnType<Scene["getNonDeletedElementsMap"]>,
): GlobalPoint => {
  const center = elementCenterPoint(el, map);
  const hit = intersectElementWithLineSegment(
    el,
    map,
    lineSegment(center, to),
    getBindingGap(el as ExcalidrawBindableElement),
  );
  return hit.length ? nearest(hit, to) : center;
};

/**
 * Puts each bound arrow on a straight line between the outlines of its start
 * and end, then binds it with Excalidraw's own binding (the elements are
 * fresh, so they are changed in place, as the converter does).
 */
const bindArrows = (
  built: ExcalidrawElement[],
  bindings: { arrowId: string; startId?: string; endId?: string }[],
): void => {
  if (!bindings.length) {
    return;
  }
  const scene = new Scene(built, { skipValidation: true });
  const map = scene.getNonDeletedElementsMap();
  for (const b of bindings) {
    const arrow = map.get(b.arrowId) as
      | NonDeleted<ExcalidrawArrowElement>
      | undefined;
    if (!arrow) {
      continue;
    }
    const start = b.startId ? map.get(b.startId) : undefined;
    const end = b.endId ? map.get(b.endId) : undefined;
    const last = arrow.points[arrow.points.length - 1];
    const freeStart = pointFrom<GlobalPoint>(arrow.x, arrow.y);
    const freeEnd = pointFrom<GlobalPoint>(
      arrow.x + last[0],
      arrow.y + last[1],
    );
    const towardsEnd = end ? elementCenterPoint(end, map) : freeEnd;
    const towardsStart = start ? elementCenterPoint(start, map) : freeStart;
    const p1 = start ? outlinePoint(start, towardsEnd, map) : freeStart;
    const p2 = end ? outlinePoint(end, towardsStart, map) : freeEnd;
    const points = [
      pointFrom<LocalPoint>(0, 0),
      pointFrom<LocalPoint>(p2[0] - p1[0], p2[1] - p1[1]),
    ];
    scene.mutateElement(arrow, {
      x: p1[0],
      y: p1[1],
      points,
      ...getSizeFromPoints(points),
    });
    if (start && start !== end) {
      bindBindingElement(
        arrow,
        start as NonDeleted<ExcalidrawBindableElement>,
        "orbit",
        "start",
        scene,
        ZOOM,
      );
    }
    if (end && end !== start) {
      bindBindingElement(
        arrow,
        end as NonDeleted<ExcalidrawBindableElement>,
        "orbit",
        "end",
        scene,
        ZOOM,
      );
    }
    // An arrow's label sits at its middle: move it with the arrow.
    const labelId = arrow.boundElements?.find((e) => e.type === "text")?.id;
    const label = labelId ? map.get(labelId) : undefined;
    if (label) {
      scene.mutateElement(
        label,
        computeBoundTextPosition(
          arrow,
          label as ExcalidrawTextElementWithContainer,
          map,
        ),
      );
    }
  }
};

export interface BuiltAdds {
  /** Every new element, labels included. */
  created: ExcalidrawElement[];
  /** Ids of the added elements in op order (labels left out). */
  ids: string[];
  /** ref -> id. */
  refs: Record<string, string>;
}

/**
 * Elements missing x and/or y are shifted as a group so their bounding box is
 * centred at `center` (relative offsets kept). A given x or y stays absolute.
 * An arrow bound with `start`/`end` moves with the element it starts at.
 */
export const buildAdds = (
  adds: readonly Pick<AddOp, "element" | "ref">[],
  center: { x: number; y: number },
  dataKey: string | null = null,
): BuiltAdds => {
  if (!adds.length) {
    return { created: [], ids: [], refs: {} };
  }
  const ids = adds.map(() => randomId());
  const refs: Record<string, string> = {};
  const idOfRef = new Map<string, string>();
  const indexOfRef = new Map<string, number>();
  adds.forEach((a, i) => {
    if (a.ref !== undefined) {
      refs[a.ref] = ids[i];
      idOfRef.set(a.ref, ids[i]);
      indexOfRef.set(a.ref, i);
    }
  });
  const built = convertToExcalidrawElements(
    adds.map((a, i) => toSkeleton(a.element, ids[i], dataKey)),
    { regenerateIds: false },
  ) as ExcalidrawElement[];
  bindArrows(
    built,
    adds.flatMap((a, i) =>
      a.element.start || a.element.end
        ? [
            {
              arrowId: ids[i],
              startId: a.element.start && idOfRef.get(a.element.start.ref),
              endId: a.element.end && idOfRef.get(a.element.end.ref),
            },
          ]
        : [],
    ),
  );

  // Which add each built element belongs to (a label belongs to its container).
  const indexOfId = new Map(ids.map((id, i) => [id, i]));
  const owner = built.map((el) => {
    const own = indexOfId.get(el.id);
    if (own !== undefined) {
      return own;
    }
    const container = (el as { containerId?: string | null }).containerId;
    return container ? indexOfId.get(container) ?? -1 : -1;
  });
  const placedBy = adds.map((a, i) => {
    const bound = a.element.start ?? a.element.end;
    return bound ? indexOfRef.get(bound.ref) ?? i : i;
  });
  const unplacedX = (i: number) =>
    i >= 0 && adds[placedBy[i]].element.x === undefined;
  const unplacedY = (i: number) =>
    i >= 0 && adds[placedBy[i]].element.y === undefined;
  const group = built.filter(
    (_, k) => unplacedX(owner[k]) || unplacedY(owner[k]),
  );
  if (!group.length) {
    return { created: built, ids, refs };
  }
  const [x1, y1, x2, y2] = getCommonBounds(group);
  const dx = center.x - (x1 + x2) / 2;
  const dy = center.y - (y1 + y2) / 2;
  // Each axis is placed on its own: a given x or y is never overwritten.
  const created = built.map((el, k) => {
    const shiftX = unplacedX(owner[k]);
    const shiftY = unplacedY(owner[k]);
    return shiftX || shiftY
      ? { ...el, x: shiftX ? el.x + dx : el.x, y: shiftY ? el.y + dy : el.y }
      : el;
  });
  return { created, ids, refs };
};

/** Kept for callers that only add: the new elements, labels included. */
export const buildElements = (
  adds: readonly NewElement[],
  center: { x: number; y: number },
): ExcalidrawElement[] =>
  buildAdds(
    adds.map((element) => ({ element })),
    center,
  ).created;

/**
 * Applies group ops to `work` (id -> element, edited in place): each gets one
 * new group id, appended (outermost last, as Excalidraw's Group action), on
 * every member and its bound label.
 */
export const applyGroups = (
  groups: readonly GroupOp[],
  work: Map<string, ExcalidrawElement>,
  refs: Readonly<Record<string, string>>,
): void => {
  if (!groups.length) {
    return;
  }
  // Labels of each container, found once.
  const labels = new Map<string, string[]>();
  for (const el of work.values()) {
    const container = (el as { containerId?: string | null }).containerId;
    if (container && !el.isDeleted) {
      const list = labels.get(container);
      if (list) {
        list.push(el.id);
      } else {
        labels.set(container, [el.id]);
      }
    }
  }
  for (const g of groups) {
    const groupId = randomId();
    for (const member of g.ids) {
      const id = typeof member === "string" ? member : refs[member.ref];
      for (const target of [id, ...(labels.get(id) ?? [])]) {
        const el = work.get(target);
        if (el) {
          work.set(
            target,
            newElementWith(el, { groupIds: [...el.groupIds, groupId] }),
          );
        }
      }
    }
  }
};
