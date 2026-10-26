import { useSyncExternalStore } from "react";

import {
  getDisplayColorTransformVersion,
  subscribeDisplayColorTransform,
} from "@excalidraw/common";

import { resolveTheme } from "../../../vault/preferences";
import { useSettings } from "../SettingsContext";

/**
 * The theme the canvas is drawn in ("light" | "dark"): the open vault's mode
 * when it overrides one, else the global mode, whatever the Settings scope. Also re-renders when the canvas colour transform changes (a theme
 * with "Sync canvas with theme"), so previews and swatches stay current.
 */
export const useCanvasTheme = (): "light" | "dark" => {
  const { win, vaultSettings } = useSettings();
  const mode = vaultSettings.effective.theme;
  useSyncExternalStore(
    subscribeDisplayColorTransform,
    getDisplayColorTransformVersion,
  );
  return resolveTheme(mode, win);
};
