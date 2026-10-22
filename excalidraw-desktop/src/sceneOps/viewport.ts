import type { AppState } from "@excalidraw/excalidraw/types";

/** Scene coordinates of the viewport centre. */
export const viewportCenter = (
  appState: Pick<AppState, "scrollX" | "scrollY" | "width" | "height"> & {
    zoom: { value: number };
  },
): { x: number; y: number } => ({
  x: appState.width / (2 * appState.zoom.value) - appState.scrollX,
  y: appState.height / (2 * appState.zoom.value) - appState.scrollY,
});
