// Exposes the thumbnail renderer to the thumbnail perf/pixel specs (built on
// its own, so the harness entry (harnessMain.tsx) stays untouched).
import {
  THUMB_MAX_ELEMENTS,
  setThumbMaxElements,
  renderPng,
  renderScenePng,
} from "../src/thumbnails/render";

export interface Step0Hooks {
  renderScenePng: typeof renderScenePng;
  /** Same renderer with the slicing switch (false = the one-task reference). */
  renderPng: typeof renderPng;
  maxElements: number;
  setThumbMaxElements: typeof setThumbMaxElements;
}

(window as unknown as { __step0: Step0Hooks }).__step0 = {
  renderScenePng,
  renderPng,
  maxElements: THUMB_MAX_ELEMENTS,
  setThumbMaxElements,
};
