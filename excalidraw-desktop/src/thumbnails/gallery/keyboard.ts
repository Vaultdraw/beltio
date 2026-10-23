/** Gallery movement: pure index maths for the `gallery.*` commands (galleryCommands.ts). */
import type { GalleryMove } from "../../commands/galleryCommands";

export interface KeyContext {
  index: number;
  count: number;
  columns: number;
  /** Rows per PageUp/PageDown. */
  pageRows: number;
}

const clamp = (n: number, count: number) => Math.max(0, Math.min(count - 1, n));

/** The tile a move lands on, or null when the grid is empty. */
export function moveIndex(move: GalleryMove, c: KeyContext): number | null {
  const { index, count, columns } = c;
  if (count === 0) {
    return null;
  }
  switch (move) {
    case "left":
      return clamp(index - 1, count);
    case "right":
      return clamp(index + 1, count);
    case "up":
      return index - columns >= 0 ? index - columns : index;
    case "down":
      // Only when a next row exists; a short last row takes its last tile.
      return Math.floor(index / columns) < Math.floor((count - 1) / columns)
        ? clamp(index + columns, count)
        : index;
    case "first":
      return 0;
    case "last":
      return count - 1;
    case "pageDown":
      return clamp(index + c.pageRows * columns, count);
    case "pageUp": {
      const up = index - c.pageRows * columns;
      return up >= 0 ? up : index % columns;
    }
  }
}
