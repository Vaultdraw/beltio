/**
 * Plugin canvas tools. Excalidraw has a "custom" tool type the host implements, so
 * this needs no change in packages/. Nothing is attached until the first plugin tool
 * is chosen; then one `onPointerDown` and one `onChange` subscription on the editor.
 * Move and up listeners exist only while a gesture runs, and moves reach the plugin
 * at most once per animation frame.
 */
import { viewportCoordsToSceneCoords } from "@excalidraw/common";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { getActiveEditor } from "../../editor/editorApi";
import { toastStore } from "../../toasts/toastStore";
import {
  getActiveToolKey,
  getToolHandlers,
  getToolStub,
  setActiveToolKey,
  type ToolStub,
} from "../toolRegistry";

import { reportPluginError } from "./errors";

import type { ToolPoint } from "../api";

type Pointerish = {
  clientX: number;
  clientY: number;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
};

interface Gesture {
  key: string;
  stop: () => void;
}

let boundApi: ExcalidrawImperativeAPI | null = null;
let unbind: (() => void) | null = null;
let gesture: Gesture | null = null;

const point = (e: Pointerish, x: number, y: number): ToolPoint => ({
  x,
  y,
  shiftKey: e.shiftKey,
  altKey: e.altKey,
  modKey: e.ctrlKey || e.metaKey,
});

/** Runs a plugin handler; a throw or rejection is attributed to the plugin, never to the canvas. */
function call(key: string, where: string, fn: () => unknown): void {
  const stub = getToolStub(key);
  const fail = (err: unknown) =>
    reportPluginError(stub?.pluginId ?? key, err, `tool ${where}`);
  try {
    const r = fn();
    if (r instanceof Promise) {
      r.catch(fail);
    }
  } catch (err) {
    fail(err);
  }
}

function endGesture(cancelled: boolean): void {
  const g = gesture;
  gesture = null;
  if (!g) {
    return;
  }
  g.stop();
  if (cancelled) {
    call(g.key, "cancel", () => getToolHandlers(g.key)?.cancel?.());
  }
}

function applyCursor(key: string | null): void {
  const canvas = document.querySelector<HTMLElement>("canvas.interactive");
  if (canvas && key) {
    canvas.style.cursor = getToolStub(key)?.cursor ?? "crosshair";
  }
}

function startGesture(
  api: ExcalidrawImperativeAPI,
  key: string,
  e: PointerEvent | React.PointerEvent,
  origin: { x: number; y: number },
): void {
  const h = getToolHandlers(key);
  if (!h) {
    return;
  }
  endGesture(true);
  const win = (e.target as Node | null)?.ownerDocument?.defaultView ?? window;
  let last: PointerEvent | null = null;
  let frame = 0;
  const scenePoint = (ev: Pointerish) => {
    const s = viewportCoordsToSceneCoords(ev, api.getAppState());
    return point(ev, s.x, s.y);
  };
  const flushMove = () => {
    frame = 0;
    if (last && h.pointerMove) {
      const p = scenePoint(last);
      call(key, "pointerMove", () => h.pointerMove!(p));
    }
  };
  const onMove = (ev: PointerEvent) => {
    last = ev;
    if (!frame) {
      frame = win.requestAnimationFrame(flushMove);
    }
  };
  const onUp = (ev: PointerEvent) => {
    if (frame) {
      win.cancelAnimationFrame(frame);
      frame = 0;
    }
    const p = scenePoint(ev);
    endGesture(false);
    call(key, "pointerUp", () => h.pointerUp?.(p));
    applyCursor(key);
  };
  const stop = () => {
    if (frame) {
      win.cancelAnimationFrame(frame);
    }
    win.removeEventListener("pointermove", onMove, true);
    win.removeEventListener("pointerup", onUp, true);
    win.removeEventListener("pointercancel", onCancel, true);
  };
  const onCancel = () => endGesture(true);
  win.addEventListener("pointermove", onMove, true);
  win.addEventListener("pointerup", onUp, true);
  win.addEventListener("pointercancel", onCancel, true);
  gesture = { key, stop };
  const p = point(e, origin.x, origin.y);
  call(key, "pointerDown", () => h.pointerDown?.(p));
}

function bind(api: ExcalidrawImperativeAPI): void {
  if (boundApi === api) {
    return;
  }
  unbind?.();
  boundApi = api;
  const offDown = api.onPointerDown((tool, state, event) => {
    if (tool.type === "custom" && getToolHandlers(tool.customType)) {
      startGesture(api, tool.customType, event, state.origin);
      // Excalidraw resets the cursor when a gesture starts; the tool picks its own.
      queueMicrotask(() => applyCursor(tool.customType));
    }
  });
  const offChange = api.onChange((_els, appState) => {
    const t = appState.activeTool;
    const key =
      t.type === "custom" && getToolStub(t.customType) ? t.customType : null;
    if (key !== getActiveToolKey()) {
      if (gesture && gesture.key !== key) {
        endGesture(true);
      }
      setActiveToolKey(key);
    }
  });
  unbind = () => {
    offDown();
    offChange();
    endGesture(true);
    boundApi = null;
    unbind = null;
  };
}

/** The palette command of a tool: choose it, or go back to selecting when it is already chosen. */
export async function toggleTool(
  stub: ToolStub,
  activate: () => Promise<boolean>,
): Promise<void> {
  const editor = getActiveEditor();
  if (!editor || editor.readOnly) {
    toastStore.push({
      message: `${stub.pluginName}: open an editable drawing first`,
      kind: "error",
    });
    return;
  }
  const { api } = editor;
  if (getActiveToolKey() === stub.key) {
    api.setActiveTool({ type: "selection" });
    return;
  }
  if (!(await activate())) {
    return;
  }
  if (!getToolHandlers(stub.key)) {
    toastStore.push({
      message: `${stub.pluginName}: tool ${stub.id} declared but not registered`,
      kind: "error",
    });
    return;
  }
  bind(api);
  api.setActiveTool({ type: "custom", customType: stub.key });
  setActiveToolKey(stub.key);
  applyCursor(stub.key);
}

/** A disabled or reloaded plugin's active tool goes back to selecting. */
export function releasePluginTools(pluginId: string): void {
  const key = getActiveToolKey();
  if (key?.startsWith(`${pluginId}.`)) {
    endGesture(true);
    getActiveEditor()?.api.setActiveTool({ type: "selection" });
    setActiveToolKey(null);
  }
}

/** Forgets the editor and any gesture (the plugin was disabled or the host stopped). */
export function resetToolEngine(): void {
  unbind?.();
  setActiveToolKey(null);
}
