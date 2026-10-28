import { useCallback, useLayoutEffect, useState, type RefObject } from "react";

/** Fixed row height; must match `.vault-tree-item` in VaultShell.css. */
export const TREE_ROW_HEIGHT = 26;
/** Top padding of `.vault-tree-container`. */
const CONTAINER_PAD_TOP = 2;
/** Below this many rows everything renders (windowing buys nothing). */
export const WINDOW_MIN_ROWS = 150;
const OVERSCAN = 12;
/** Used when the container has no layout yet (first paint, jsdom). */
const FALLBACK_VIEWPORT = 800;

export type RowWindow = { start: number; end: number };

/** Rows [start, end) to mount for a scroll position; pure for testing. */
export function computeWindow(
  total: number,
  firstRow: number,
  viewport: number,
): RowWindow {
  if (total <= WINDOW_MIN_ROWS) {
    return { start: 0, end: total };
  }
  const visible = Math.ceil(viewport / TREE_ROW_HEIGHT) + 1;
  const start = Math.min(Math.max(0, firstRow - OVERSCAN), total);
  const end = Math.min(total, firstRow + visible + OVERSCAN);
  return { start: Math.min(start, end), end };
}

/**
 * Mounts only the rows near the scroll position of `containerRef` (the tree's
 * scroller). State changes when the first visible row or the viewport height
 * changes, not on every scroll pixel.
 */
export function useTreeWindow(
  containerRef: RefObject<HTMLElement | null>,
  total: number,
  active: boolean,
) {
  const [view, setView] = useState({
    firstRow: 0,
    viewport: FALLBACK_VIEWPORT,
  });

  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    const firstRow = Math.max(
      0,
      Math.floor((el.scrollTop - CONTAINER_PAD_TOP) / TREE_ROW_HEIGHT),
    );
    const viewport = el.clientHeight || FALLBACK_VIEWPORT;
    setView((v) =>
      v.firstRow === firstRow && v.viewport === viewport
        ? v
        : { firstRow, viewport },
    );
  }, [containerRef]);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || !active || total <= WINDOW_MIN_ROWS) {
      return;
    }
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [containerRef, active, measure, total > WINDOW_MIN_ROWS]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Scrolls so row `index` is fully visible (no-op when it already is). */
  const scrollToRow = useCallback(
    (index: number) => {
      const el = containerRef.current;
      if (!el || index < 0) {
        return;
      }
      const top = CONTAINER_PAD_TOP + index * TREE_ROW_HEIGHT;
      const height = el.clientHeight || FALLBACK_VIEWPORT;
      if (top < el.scrollTop) {
        el.scrollTop = top;
      } else if (top + TREE_ROW_HEIGHT > el.scrollTop + height) {
        el.scrollTop = top + TREE_ROW_HEIGHT - height;
      }
    },
    [containerRef],
  );

  const range =
    active && total > WINDOW_MIN_ROWS
      ? computeWindow(total, view.firstRow, view.viewport)
      : { start: 0, end: total };
  return { ...range, scrollToRow };
}
