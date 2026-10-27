/**
 * Double-click on a formula image: hand the edit to the formula plugin. The editor calls this
 * for every image double-click, so it stays tiny and imports nothing from the plugin host (the
 * host loads only when an edit really starts).
 */
import { enabledPluginIds } from "./enabledIds";

import type { ExcalidrawImageElement } from "@excalidraw/element/types";

/** Runs a command of an official plugin, starting the host first (set by boot). */
let runner: ((fullId: string) => Promise<void>) | null = null;

export const setFormulaEditRunner = (
  fn: ((fullId: string) => Promise<void>) | null,
): void => {
  runner = fn;
};

/**
 * True when the image is a formula (it carries `latex` data) and the formula plugin is on, so the
 * editor skips its own image handling. The plugin reads the selected element and opens its dialog.
 */
export function editFormulaImage(
  win: Window,
  el: ExcalidrawImageElement,
  viewMode: boolean,
): boolean {
  if (viewMode || el.locked || !runner) {
    return false;
  }
  const data = el.customData?.latex;
  if (!data || typeof data !== "object") {
    return false;
  }
  if (!enabledPluginIds(win).includes("formula")) {
    return false;
  }
  void runner("formula.edit");
  return true;
}
