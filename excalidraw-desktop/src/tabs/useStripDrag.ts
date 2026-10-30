/**
 * Tabs: pointer-event drag reorder for the strip (no HTML5 DnD). Geometry is
 * read once at drag start; during the drag only a transform on the dragged tab
 * and the indicator's left change, so React never re-renders.
 */

import { useCallback, useEffect, useRef } from "react";

import { startHorizontalEdgeScroll } from "../components/edgeScroll";

import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import type { TabId } from "./types";

export const DRAG_THRESHOLD_PX = 4;

/**
 * Final index of the dragged tab for pointer `x`: the number of other tabs
 * whose midpoint is left of it, clamped to the dragged tab's group [lo, hi].
 */
export const dropIndex = (
  midpoints: readonly number[],
  x: number,
  from: number,
  lo = 0,
  hi = midpoints.length - 1,
): number => {
  let slot = 0;
  for (let i = 0; i < midpoints.length; i++) {
    if (i !== from && midpoints[i] < x) {
      slot++;
    }
  }
  return Math.max(lo, Math.min(hi, slot));
};

type DragTab = { id: TabId; pinned: boolean };

interface Options {
  listRef: RefObject<HTMLElement | null>;
  indicatorRef: RefObject<HTMLElement | null>;
  getTabs: () => readonly DragTab[];
  /** Absent = dragging disabled. */
  onMove?: (id: TabId, toIndex: number) => void;
}

export function useStripDrag({
  listRef,
  indicatorRef,
  getTabs,
  onMove,
}: Options) {
  const justDragged = useRef(false);
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  const onTabPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>, id: TabId) => {
      justDragged.current = false;
      if (
        !onMove ||
        e.button !== 0 ||
        (e.target as HTMLElement).closest("button")
      ) {
        return;
      }
      const el = e.currentTarget;
      const doc = el.ownerDocument;
      const startX = e.clientX;
      const pointerId = e.pointerId;
      let dragging = false;
      let slot = -1;
      let from = -1;
      let rects: { left: number; right: number }[] = [];
      let lo = 0;
      let hi = 0;
      let stripLeft = 0;
      let listLeft = 0;
      let scroll0 = 0;
      let lastX = startX;
      let stopEdgeScroll: (() => void) | null = null;

      const reset = () => {
        el.style.transform = "";
        el.classList.remove("vault-tabs__tab--dragging");
        if (indicatorRef.current) {
          indicatorRef.current.hidden = true;
        }
      };
      const stop = () => {
        doc.removeEventListener("pointermove", move);
        doc.removeEventListener("pointerup", up);
        doc.removeEventListener("pointercancel", cancel);
        doc.removeEventListener("keydown", key, true);
        stopEdgeScroll?.();
        stopEdgeScroll = null;
        cleanup.current = null;
        if (dragging) {
          reset();
          justDragged.current = true;
          setTimeout(() => {
            justDragged.current = false;
          }, 0);
        }
      };
      const begin = () => {
        const tabs = getTabs();
        const kids = listRef.current?.children;
        from = tabs.findIndex((t) => t.id === id);
        if (from < 0 || !kids || kids.length !== tabs.length) {
          return false;
        }
        // content space (scroll-independent): the strip scrolls while a drag is held at its edge
        const list = listRef.current;
        scroll0 = list?.scrollLeft ?? 0;
        listLeft = list?.getBoundingClientRect().left ?? 0;
        rects = Array.from(kids, (k) => {
          const r = k.getBoundingClientRect();
          return {
            left: r.left - listLeft + scroll0,
            right: r.right - listLeft + scroll0,
          };
        });
        const pinnedCount = tabs.filter((t) => t.pinned).length;
        [lo, hi] = tabs[from].pinned
          ? [0, pinnedCount - 1]
          : [pinnedCount, tabs.length - 1];
        stripLeft =
          listRef.current?.parentElement?.getBoundingClientRect().left ?? 0;
        try {
          el.setPointerCapture?.(pointerId);
        } catch {
          // synthetic pointer: nothing to capture
        }
        el.classList.add("vault-tabs__tab--dragging");
        return true;
      };
      /** Place the dragged tab and the drop indicator for the latest pointer x and scroll. */
      const update = () => {
        const scroll = listRef.current?.scrollLeft ?? 0;
        // keep the tab inside the content so a transform never grows the scroll range
        const own = rects[from];
        const dx = Math.max(
          rects[0].left - own.left,
          Math.min(
            rects[rects.length - 1].right - own.right,
            lastX - startX + (scroll - scroll0),
          ),
        );
        el.style.transform = `translateX(${dx}px)`;
        slot = dropIndex(
          rects.map((r) => (r.left + r.right) / 2),
          lastX - listLeft + scroll,
          from,
          lo,
          hi,
        );
        const others = rects.filter((_, i) => i !== from);
        const edge = slot === 0 ? others[0]?.left : others[slot - 1]?.right;
        const ind = indicatorRef.current;
        if (ind && edge !== undefined) {
          ind.hidden = false;
          ind.style.left = `${edge - scroll + listLeft - stripLeft}px`;
        }
      };
      function move(ev: PointerEvent) {
        if (ev.pointerId !== pointerId) {
          return;
        }
        lastX = ev.clientX;
        const dx = ev.clientX - startX;
        if (!dragging) {
          if (Math.abs(dx) < DRAG_THRESHOLD_PX) {
            return;
          }
          if (!begin()) {
            return stop();
          }
          dragging = true;
          if (listRef.current) {
            stopEdgeScroll = startHorizontalEdgeScroll(
              listRef.current,
              () => lastX,
              update,
            );
          }
        }
        update();
      }
      function up(ev: PointerEvent) {
        if (ev.pointerId !== pointerId) {
          return;
        }
        const moved = dragging && slot >= 0 && slot !== from;
        stop();
        if (moved) {
          onMove?.(id, slot);
        }
      }
      function cancel() {
        stop();
      }
      function key(ev: KeyboardEvent) {
        if (ev.key === "Escape") {
          ev.stopPropagation();
          stop();
        }
      }
      doc.addEventListener("pointermove", move);
      doc.addEventListener("pointerup", up);
      doc.addEventListener("pointercancel", cancel);
      doc.addEventListener("keydown", key, true);
      cleanup.current = stop;
    },
    [getTabs, indicatorRef, listRef, onMove],
  );

  /** True once, right after a drag ends: the click that follows is not an activation. */
  const wasDrag = useCallback(() => {
    const was = justDragged.current;
    justDragged.current = false;
    return was;
  }, []);

  return { onTabPointerDown, wasDrag };
}
