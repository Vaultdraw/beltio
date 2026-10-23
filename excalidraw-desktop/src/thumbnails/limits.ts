/**
 * The element cap of the PNG thumbnail render, as a preference
 * (`interface.thumbnail_max_elements`). No heavy imports: preferences read it.
 *
 * Default 8000 (2026-10-23, e2e/thumbnailsBlocking.spec.ts, Chromium, longest
 * main-thread task per thumbnail at 4x / 6x CPU throttle): 2500 elements
 * 18 / 23 ms, 5000 22 / 29 ms, 8000 21 / 42 ms, 10000 34 / 48 ms. Restore,
 * bounds and paint are sliced; the remaining long step is JSON.parse, which
 * grows with the scene. 8000 keeps the 50 ms budget at 6x with headroom.
 */
export const DEFAULT_THUMB_MAX_ELEMENTS = 8000;
export const MIN_THUMB_MAX_ELEMENTS = 100;
/** Past this the JSON.parse alone is a long task even on a fast machine. */
export const MAX_THUMB_MAX_ELEMENTS = 50000;
