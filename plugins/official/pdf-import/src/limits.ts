/** Fixed limits of one import. The user-set ones come from `ctx.pdf.settings()`. */
export const LIMITS = {
  /** Never render below this long side, whatever the budgets say. */
  minSide: 800,
  /** Pages per import (page mode itself allows at most 500 pages). */
  maxPages: 200,
} as const;

/** Mirrors the native drawing cap (the largest drawing file). */
export const MAX_DRAWING_BYTES = 32 * 1024 * 1024;
/** Share of the cap an import may fill (headroom for annotations). */
export const DRAWING_BYTES_HEADROOM = 0.9;
/** Largest single picture `scene.batch` takes. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** Page sizes are in points; the scene is in pixels at 96 dpi. */
export const PT_TO_SCENE = 96 / 72;
