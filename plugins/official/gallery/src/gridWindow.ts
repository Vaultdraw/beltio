/**
 * Pure windowing math for the gallery grid: fixed-size tiles in rows, columns
 * from the container width. Only the visible rows plus an overscan are mounted;
 * the window object only changes (by value) when the first visible row,
 * the column count or the item count change.
 */
export interface GridMetrics {
  /** Content width of the scroll container (without padding). */
  viewportWidth: number;
  viewportHeight: number;
  tileWidth: number;
  tileHeight: number;
  gap: number;
  count: number;
  /** Rows mounted above and below the visible rows. */
  overscanRows?: number;
}

export interface GridWindow {
  columns: number;
  rowCount: number;
  /** Row pitch: tile height + gap. */
  rowHeight: number;
  totalHeight: number;
  firstRow: number;
  lastRow: number;
  /** Inclusive item range to mount (first > last when empty). */
  first: number;
  last: number;
}

export const columnsFor = (
  width: number,
  tileWidth: number,
  gap: number,
): number => Math.max(1, Math.floor((width + gap) / (tileWidth + gap)));

export function computeGridWindow(
  scrollTop: number,
  m: GridMetrics,
): GridWindow {
  const columns = columnsFor(m.viewportWidth, m.tileWidth, m.gap);
  const rowHeight = m.tileHeight + m.gap;
  const rowCount = Math.ceil(m.count / columns);
  const totalHeight = Math.max(0, rowCount * rowHeight - m.gap);
  if (m.count === 0) {
    return {
      columns,
      rowCount: 0,
      rowHeight,
      totalHeight: 0,
      firstRow: 0,
      lastRow: -1,
      first: 0,
      last: -1,
    };
  }
  const over = m.overscanRows ?? 1;
  const top = Math.max(0, Math.min(scrollTop, totalHeight));
  const visibleFirst = Math.floor(top / rowHeight);
  const visibleLast = Math.floor((top + m.viewportHeight - 1) / rowHeight);
  const firstRow = Math.max(0, visibleFirst - over);
  const lastRow = Math.min(rowCount - 1, visibleLast + over);
  return {
    columns,
    rowCount,
    rowHeight,
    totalHeight,
    firstRow,
    lastRow,
    first: firstRow * columns,
    last: Math.min(m.count - 1, (lastRow + 1) * columns - 1),
  };
}

export const sameWindow = (a: GridWindow, b: GridWindow): boolean =>
  a.columns === b.columns &&
  a.rowCount === b.rowCount &&
  a.firstRow === b.firstRow &&
  a.lastRow === b.lastRow &&
  a.rowHeight === b.rowHeight &&
  a.totalHeight === b.totalHeight;

/** Rows that fit fully in the viewport (at least 1), for PageUp/PageDown. */
export const pageRows = (viewportHeight: number, rowHeight: number): number =>
  Math.max(1, Math.floor(viewportHeight / rowHeight));

/** The scrollTop that brings `index`'s row fully into view (or the same). */
export function scrollTopToReveal(
  index: number,
  scrollTop: number,
  m: GridMetrics,
): number {
  const columns = columnsFor(m.viewportWidth, m.tileWidth, m.gap);
  const rowHeight = m.tileHeight + m.gap;
  const row = Math.floor(index / columns);
  const rowTop = row * rowHeight;
  const rowBottom = rowTop + m.tileHeight;
  if (rowTop < scrollTop) {
    return rowTop;
  }
  if (rowBottom > scrollTop + m.viewportHeight) {
    return rowBottom - m.viewportHeight;
  }
  return scrollTop;
}
