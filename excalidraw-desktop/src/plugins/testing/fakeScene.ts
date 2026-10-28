/**
 * A minimal fake editor registered as the active one through the real
 * editorApi, so the real sceneBus / applyOps / read-only gating are exercised.
 */
import { newElement } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type {
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";

import { registerEditorApi } from "../../editor/editorApi";

import type { NewElement } from "../api";

/** A NewElement (optionally with an id) or a full editor element. */
export type FakeElementInput =
  | (Omit<NewElement, "type"> & {
      /** `frame` is accepted so tests can seed one (a plugin cannot add a frame). */
      type: NewElement["type"] | "frame";
      id?: string;
    })
  | ExcalidrawElement;

export interface FakeBatch {
  captureUpdate: unknown;
  elements: readonly ExcalidrawElement[];
}

export interface FakeScene {
  /** Replaces the scene (like a load) and signals a change. */
  setElements(els: readonly FakeElementInput[]): void;
  /**
   * An edit happened: bumps every element version (a scene with no elements
   * has no version to change, so the bus ignores it) and fires api.onChange.
   */
  emitChange(): void;
  /** Another drawing becomes active; null = no drawing open (also a swap in progress). */
  switchTo(path: string | null): void;
  readOnly(flag: boolean): void;
  /** One entry per updateScene call = per undo step. */
  readonly batches: FakeBatch[];
  /** Non-deleted elements as the editor holds them. */
  live(): readonly ExcalidrawElement[];
  /** Pictures in the editor's file store, by SHA-1, with their bytes decoded (same shape as the SDK mock). */
  files(): Record<string, { mime: string; bytes: Uint8Array }>;
  /** Ids `ctx.scene.scrollTo` asked the shell to focus, in order. */
  scrolledTo(): string[];
  /** Selects elements as the user would (`ctx.scene.selection`). */
  select(ids: readonly string[]): void;
  /** Sets the stroke colour a new element gets (`ctx.scene.currentStrokeColor`). */
  strokeColor(color: string): void;
  /** The app state fields `updateScene` set (such as `pageSetup`). */
  appState(): Record<string, unknown>;
  /** What `ctx.scene.fitTo` asked the editor to show, in order. */
  fittedTo(): {
    id: string;
    padding: number;
    select: boolean;
    animate: boolean;
  }[];
  /** Records a `scrollTo` (the shell's focus path, called by the bridge). */
  recordScroll(id: string): void;
  /** Sets app state fields as a load would (the bridge's create path). */
  updateAppState(next: Record<string, unknown>): void;
  /** Unregisters the editor. */
  dispose(): void;
}

const isFull = (e: FakeElementInput): e is ExcalidrawElement =>
  "version" in e && "seed" in e;

let versionClock = 1;
let docClock = 0;

const toElement = (input: FakeElementInput, n: number): ExcalidrawElement => {
  if (isFull(input)) {
    return input;
  }
  const { type, text, id, name, ...rest } = input as typeof input & {
    name?: string;
  };
  const base = newElement({ type: "rectangle", ...rest } as never);
  return {
    ...base,
    id: id ?? `fake-${n}`,
    type,
    ...(text === undefined ? {} : { text }),
    ...(name === undefined ? {} : { name }),
    version: ++versionClock,
  } as unknown as ExcalidrawElement;
};

export function createFakeScene(initialPath: string | null): FakeScene {
  let elements: ExcalidrawElement[] = [];
  let path = initialPath;
  let readOnly = false;
  let off: (() => void) | null = null;
  const listeners = new Set<() => void>();
  const batches: FakeBatch[] = [];
  let store: BinaryFiles = {};
  let appState: Record<string, unknown> = {};
  const scrolled: string[] = [];
  const fitted: {
    id: string;
    padding: number;
    select: boolean;
    animate: boolean;
  }[] = [];
  let liveFor: ExcalidrawElement[] | null = null;
  let liveCache: ExcalidrawElement[] = [];
  /** The same array while the elements are the same, as the real editor gives. */
  const liveNow = () => {
    if (liveFor !== elements) {
      liveFor = elements;
      liveCache = elements.filter((e) => !e.isDeleted);
    }
    return liveCache;
  };
  const fire = () => [...listeners].forEach((cb) => cb());

  const api = {
    getSceneElements: () => liveNow(),
    getSceneElementsIncludingDeleted: () => elements,
    getAppState: () => ({
      width: 800,
      height: 600,
      scrollX: 0,
      scrollY: 0,
      zoom: { value: 1 },
      viewModeEnabled: false,
      viewBackgroundColor: "#ffffff",
      frameRendering: { enabled: true, clip: true, name: true, outline: true },
      activeTool: { type: "selection" },
      ...appState,
    }),
    setActiveTool(tool: { type: string }) {
      appState = { ...appState, activeTool: { type: tool.type } };
    },
    setViewport(opts: {
      target: [number, number, number, number];
      animation?: boolean;
      offsets?: { top?: number };
    }) {
      const [x1, y1, x2, y2] = opts.target;
      const el = elements.find(
        (e) =>
          !e.isDeleted &&
          e.x === x1 &&
          e.y === y1 &&
          e.x + e.width === x2 &&
          e.y + e.height === y2,
      );
      fitted.push({
        id: el?.id ?? "",
        padding: opts.offsets?.top ?? 0,
        select: Boolean(
          el &&
            (appState.selectedElementIds as Record<string, true> | undefined)?.[
              el.id
            ],
        ),
        animate: opts.animation !== false,
      });
    },
    getFiles: () => store,
    addFiles(list: readonly { id: string }[]) {
      for (const f of list) {
        store = { ...store, [f.id]: f } as BinaryFiles;
      }
    },
    updateScene(data: {
      elements?: readonly ExcalidrawElement[];
      appState?: Record<string, unknown>;
      captureUpdate?: unknown;
    }) {
      if (data.appState) {
        appState = { ...appState, ...data.appState };
      }
      if (data.elements) {
        elements = [...data.elements];
        batches.push({ captureUpdate: data.captureUpdate, elements });
        fire();
      }
    },
    onChange(cb: () => void) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  } as unknown as ExcalidrawImperativeAPI;

  const register = () => {
    off?.();
    off = null;
    if (path !== null) {
      off = registerEditorApi(`fake-doc-${++docClock}`, api, () => ({
        path,
        readOnly,
      }));
    }
  };
  register();

  return {
    setElements(els) {
      elements = els.map((e, i) => toElement(e, i));
      fire();
    },
    emitChange() {
      elements = elements.map((e) => ({ ...e, version: ++versionClock }));
      fire();
    },
    switchTo(next) {
      path = next;
      register();
    },
    readOnly(flag) {
      readOnly = flag;
    },
    batches,
    files: () =>
      Object.fromEntries(
        Object.entries(store).map(([id, f]) => [
          id,
          {
            mime: f.mimeType,
            bytes: Uint8Array.from(atob(f.dataURL.split(",")[1]), (c) =>
              c.charCodeAt(0),
            ),
          },
        ]),
      ),
    live: () => elements.filter((e) => !e.isDeleted),
    scrolledTo: () => [...scrolled],
    fittedTo: () => fitted.map((f) => ({ ...f })),
    select(ids: readonly string[]) {
      appState = {
        ...appState,
        selectedElementIds: Object.fromEntries(ids.map((id) => [id, true])),
      };
    },
    strokeColor(color: string) {
      appState = { ...appState, currentItemStrokeColor: color };
    },
    appState: () => ({ ...appState }),
    recordScroll: (id) => {
      scrolled.push(id);
    },
    updateAppState: (next) => {
      appState = { ...appState, ...next };
    },
    dispose() {
      off?.();
      off = null;
    },
  };
}
