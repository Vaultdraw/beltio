/**
 * Commit-time page enforcement. The editor clamps pointer gestures live;
 * this pulls back everything else (paste, duplicate, nudge, align, flip,
 * library inserts, text that grew, undo/redo) once it is committed.
 *
 * Rule: only elements ADDED or CHANGED since the last check are looked at.
 * One that is not where content may be (getClampToPageOffset) is translated
 * into the page nearest its centre, together with everything that moves
 * with it (group, bound text, frame children). Anything that was already
 * outside and was not touched stays where it is: old drawings are never
 * rearranged.
 *
 * Text flows: a free text box that starts on a page and runs past its bottom
 * edge (Enter after a heading, a box that grew) moves to the top of the next
 * page, as in Typst or Word, instead of being pulled up over what is above it.
 */
import {
  getClampToPageOffset,
  getPageIndexAt,
  getPageRect,
} from "@excalidraw/excalidraw/data/pageSetup";
import { isTextElement } from "@excalidraw/element";

import type { PageSetup } from "@excalidraw/excalidraw/data/pageSetup";

import type { ElementsMap, ExcalidrawElement } from "@excalidraw/element/types";

import { getUnitBounds, partitionIntoUnits, type Bounds } from "./moveUnits";
import { translateElements, type Move } from "./translate";

/** Elements that carry the check: bound text is judged through its container. */
const candidateOf = (
  element: ExcalidrawElement,
  elementsMap: ElementsMap,
): ExcalidrawElement | null => {
  if (element.isDeleted) {
    return null;
  }
  if (isTextElement(element) && element.containerId) {
    const container = elementsMap.get(element.containerId);
    return container && !container.isDeleted ? container : null;
  }
  return element;
};

/** Where a free text crossing its page's bottom edge flows to (separate sheets only), else null. */
const flowToNextPage = (
  setup: PageSetup,
  ids: readonly string[],
  [x1, y1, x2, y2]: Bounds,
  elementsMap: ElementsMap,
): { dx: number; dy: number } | null => {
  if (setup.layout === "continuous") {
    return null;
  }
  const allFreeText = ids.every((id) => {
    const el = elementsMap.get(id);
    return !!el && isTextElement(el) && !el.containerId;
  });
  if (!allFreeText) {
    return null;
  }
  const index = getPageIndexAt(setup, y1);
  const page = getPageRect(setup, index);
  const bottom = page.y + page.height;
  if (
    index + 1 >= setup.pageCount ||
    y1 < page.y ||
    y2 <= bottom ||
    y2 - y1 > page.height
  ) {
    return null;
  }
  // A top at or below the edge (in the gap between two sheets: Enter under a heading that ends
  // just above it) flows down too; the nearest-page clamp would pull it up over the heading
  // (toimprove 302).
  const next = getPageRect(setup, index + 1);
  const dy = next.y - y1;
  const { dx } = getClampToPageOffset(
    setup,
    [x1, y1 + dy, x2, y2 + dy],
    index + 1,
  );
  return { dx, dy };
};

/** Translation per element id that brings the changed elements back inside; empty = all fine. */
export const planEnforcement = (
  setup: PageSetup,
  elements: readonly ExcalidrawElement[],
  changed: readonly ExcalidrawElement[],
  selectedIds: Readonly<Record<string, true>>,
  elementsMap: ElementsMap,
): Map<string, Move> => {
  const moves = new Map<string, Move>();
  const outside: ExcalidrawElement[] = [];
  const seen = new Set<string>();
  for (const element of changed) {
    const candidate = candidateOf(element, elementsMap);
    if (!candidate || seen.has(candidate.id)) {
      continue;
    }
    seen.add(candidate.id);
    const bounds = getUnitBounds([candidate.id], elementsMap);
    if (!bounds) {
      continue;
    }
    const { dx, dy } = getClampToPageOffset(setup, bounds);
    if (dx !== 0 || dy !== 0) {
      outside.push(candidate);
    }
  }
  if (!outside.length) {
    return moves;
  }

  const partition = partitionIntoUnits(elements, elementsMap);
  // outside elements that are part of the selection move as one set
  const selected = outside.filter((element) => selectedIds[element.id]);
  const keys = new Map<string, string[]>();
  for (const element of outside) {
    const base = partition.keyOf(element.id) ?? `e:${element.id}`;
    const key = selected.length > 1 && selectedIds[element.id] ? "sel" : base;
    const list = keys.get(key);
    if (list) {
      list.push(base);
    } else {
      keys.set(key, [base]);
    }
  }
  for (const bases of keys.values()) {
    const ids = [...new Set(bases)].flatMap(
      (base) => partition.units.get(base) ?? [],
    );
    const bounds: Bounds | null = getUnitBounds(ids, elementsMap);
    if (!bounds) {
      continue;
    }
    const { dx, dy } =
      flowToNextPage(setup, ids, bounds, elementsMap) ??
      getClampToPageOffset(setup, bounds);
    if (dx === 0 && dy === 0) {
      continue;
    }
    for (const id of ids) {
      if (!moves.has(id)) {
        moves.set(id, { dx, dy });
      }
    }
  }
  return moves;
};

/** `elements` with the planned moves applied (same array when there are none). */
export const enforceChanged = (
  setup: PageSetup,
  elements: readonly ExcalidrawElement[],
  changed: readonly ExcalidrawElement[],
  selectedIds: Readonly<Record<string, true>>,
  elementsMap: ElementsMap,
): readonly ExcalidrawElement[] =>
  translateElements(
    elements,
    planEnforcement(setup, elements, changed, selectedIds, elementsMap),
  );
