import { getPluginsBackend } from "../plugins/host/backend";
import { flushSettings } from "../vault/settingsSync";

/** The running canvases were created with this memory.low_memory_canvas value. */
export const runningLowMemoryCanvas = (win: Window): boolean =>
  win.EXCALIDRAW_LOW_MEMORY_CANVAS === true;

/** The saved low-memory canvas value differs from the running one: a restart applies it. */
export const lowMemoryCanvasNeedsRestart = (
  saved: boolean,
  win: Window,
): boolean => saved !== runningLowMemoryCanvas(win);

/** Saves pending settings, then quits and relaunches the app (command `app.restart`). */
export async function restartApp(): Promise<void> {
  try {
    await flushSettings();
  } catch {
    // the relaunch still goes ahead; settings are written as they change
  }
  await getPluginsBackend().restart();
}
