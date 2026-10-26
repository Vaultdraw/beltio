import { getPreferences } from "../vault/preferences";

import { registerPurge } from "./purgeRegistry";
import { installPurgeTriggers } from "./triggers";

/**
 * Register the editor caches and start the triggers. Everything heavy is imported lazily so
 * startup does not pay for it; failures are never fatal.
 */
export function installMemoryManagement(win: Window): () => void {
  let disposed = false;
  let dispose = () => {
    disposed = true;
  };

  void (async () => {
    try {
      const [{ invoke }, { listen }, element] = await Promise.all([
        import("@tauri-apps/api/core"),
        import("@tauri-apps/api/event"),
        import("@excalidraw/element"),
      ]);
      if (disposed) {
        return;
      }
      // Rendered-element canvases (byte-budgeted LRU): rebuilt lazily on the next paint, so
      // they are only dropped when hidden, under pressure, or on request. Rough shapes stay:
      // they are small and regenerating thousands of them is slow.
      const unregister = [
        registerPurge(
          "elementCanvasCache",
          () => element.clearElementCanvasCache(),
          { scope: "all" },
        ),
      ];
      const stop = installPurgeTriggers({
        win,
        releaseNative: () => invoke("release_memory"),
        getDelays: () => {
          const p = getPreferences(win);
          return {
            hiddenMs: p.memoryHiddenPurgeS * 1000,
            idleMs: p.memoryIdlePurgeS * 1000,
          };
        },
        onPressure: (handler) => {
          const pending = listen("memory-pressure", handler);
          return () => void pending.then((unlisten) => unlisten());
        },
      });
      dispose = () => {
        disposed = true;
        stop();
        unregister.forEach((u) => u());
      };
    } catch {
      // Plain browser (no Tauri): memory management is simply off.
    }
  })();

  return () => dispose();
}
