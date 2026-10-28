/**
 * `ctx.present`: a full-screen, read-only presentation of the open drawing. It reuses focus mode
 * to hide the app's chrome (so `[focus] hide` shapes it and Escape ends it), keeps the editor's
 * own laser tool, and defines the context key `present.active` while it runs. Built on first
 * use; nothing is attached while no session runs.
 */
import { defineContextKey, PRESENT_KEY } from "../../commands/contextKeys";
import { getActiveEditor, onActiveEditorChange } from "../../editor/editorApi";
import { FOCUS_PRESET } from "../../layout/layoutSettings";
import {
  getLayoutState,
  setActivePreset,
  subscribeLayout,
} from "../../layout/layoutStore";
import { getActiveScene } from "../../sceneOps/sceneBus";
import { isTauriAvailable } from "../../vault/DesktopVaultRepository";

import { PluginApiError } from "../../../../sdk/api/shared/rules";

import { errorText, logLine } from "./errors";

import type { Disposable, PresentApi, PresentOptions } from "../api";

/** The context key a command can name in `when` to act only during a presentation. */
export const PRESENT_CONTEXT_KEY = PRESENT_KEY;

interface Running {
  end(): void;
}

/** One session at a time, across plugins. */
let running: Running | null = null;

/**
 * The native window's full-screen state; true when this call changed it. Only the app has a window
 * to fill (a browser page stays as it is: its own Escape would leave full screen before ours).
 */
async function setFullscreen(on: boolean): Promise<boolean> {
  try {
    if (!isTauriAvailable(window)) {
      return false;
    }
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    if ((await win.isFullscreen()) === on) {
      return false;
    }
    await win.setFullscreen(on);
    return true;
  } catch {
    // The platform refuses: present in the window instead.
    return false;
  }
}

export function createPresentApi(
  pluginId: string,
  track: (fn: () => void) => Disposable,
): PresentApi {
  return {
    get active() {
      return running !== null;
    },
    async start(options: PresentOptions = {}) {
      const scene = getActiveScene();
      if (!scene) {
        throw new PluginApiError("NOT_FOUND", "No drawing is open");
      }
      running?.end();
      const { api } = scene;
      const before = api.getAppState();
      const prevPreset = getLayoutState().preset;
      const prevView = before.viewModeEnabled;
      const prevBackground = before.viewBackgroundColor;
      const prevFrames = before.frameRendering;
      const wantsFull = options.fullscreen !== false;
      let enteredFullscreen = false;
      let ended = false;

      const detach: (() => void)[] = [];
      const documentId = getActiveEditor()?.documentId;
      const sameEditor = () => {
        const now = getActiveEditor();
        return now?.api === api && now.documentId === documentId;
      };

      const end = () => {
        if (ended) {
          return;
        }
        ended = true;
        if (running === self) {
          running = null;
        }
        detach.splice(0).forEach((fn) => fn());
        const now = getActiveEditor();
        if (now?.api === api) {
          // The same drawing gets its own state back; a different drawing in the same editor only
          // loses the view lock and the frame hiding (it keeps its own background).
          const same = now.documentId === documentId;
          api.updateScene({
            appState: same
              ? {
                  viewModeEnabled: prevView,
                  viewBackgroundColor: prevBackground,
                  frameRendering: prevFrames,
                }
              : {
                  viewModeEnabled: now.readOnly,
                  viewBackgroundColor: api.getAppState().viewBackgroundColor,
                  frameRendering: prevFrames,
                },
            captureUpdate: "NEVER",
          });
          api.setActiveTool({ type: "selection" });
        }
        if (getLayoutState().preset === FOCUS_PRESET) {
          setActivePreset(prevPreset === FOCUS_PRESET ? null : prevPreset);
        }
        if (enteredFullscreen) {
          void setFullscreen(false);
        }
        try {
          options.onEnd?.();
        } catch (err) {
          logLine(pluginId, "error", `present.onEnd: ${errorText(err)}`);
        }
      };
      const self: Running = { end };
      running = self;
      detach.push(defineContextKey(PRESENT_CONTEXT_KEY, () => true));

      api.updateScene({
        appState: {
          viewModeEnabled: true,
          selectedElementIds: {},
          selectedGroupIds: {},
          editingGroupId: null,
          viewBackgroundColor: options.background || prevBackground,
          // The slide is the frame: no frame outline or name drawn around it.
          frameRendering: { ...prevFrames, name: false, outline: false },
        },
        captureUpdate: "NEVER",
      });
      api.setActiveTool({ type: "selection" });
      setActivePreset(FOCUS_PRESET);
      // Leaving focus mode (Escape, the palette) ends the session; so does another drawing.
      detach.push(
        subscribeLayout(() => {
          if (getLayoutState().preset !== FOCUS_PRESET) {
            end();
          }
        }),
        onActiveEditorChange(() => {
          if (!sameEditor()) {
            end();
          }
        }),
      );
      if (wantsFull) {
        enteredFullscreen = await setFullscreen(true);
        if (ended && enteredFullscreen) {
          void setFullscreen(false);
        }
      }
      track(end);
      return {
        end,
        dispose: end,
        get isActive() {
          return !ended;
        },
        setLaser(on: boolean) {
          if (!ended && sameEditor()) {
            api.setActiveTool({ type: on ? "laser" : "selection" });
          }
        },
        get laser() {
          return !ended && api.getAppState().activeTool.type === "laser";
        },
      };
    },
  };
}
