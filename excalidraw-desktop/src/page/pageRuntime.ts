/**
 * Page mode while a drawing is open, driven from the editor's onChange:
 *  - view lock (width-fitted, vertical scroll only), re-installed when the
 *    window or pages change or something cleared it;
 *  - commit-time enforcement of the page (elements added or changed since
 *    the last check are pulled inside a page);
 *  - auto-extend (a page is added as content reaches the last quarter);
 *  - the paper-theme display override and the "outside the page" count.
 *
 * Nothing runs per frame: onChange does a few cheap comparisons, the real
 * work happens in a microtask, only after a committed change (no gesture in
 * progress) and never in read-only editors.
 */
import { arrayToMap } from "@excalidraw/common";
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import {
  isPageModeOn,
  PAPER_THEME_COLORS,
  pageSetupKey,
} from "@excalidraw/excalidraw/data/pageSetup";

import type { PageSetup } from "@excalidraw/excalidraw/data/pageSetup";

import type {
  AppState,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";

import type { ElementsMap, ExcalidrawElement } from "@excalidraw/element/types";

import { setPageDisplay } from "../editor/canvasSync";

import { enforceChanged } from "./enforcement";
import { getExtendedPageCount, OutsideIndex } from "./pageContent";
import { setPageStatus } from "./pageStatus";
import { reconcilePageView, type PageViewMemory } from "./pageView";
import { VersionTracker } from "./versionTracker";

export type PageRuntimeApi = Pick<
  ExcalidrawImperativeAPI,
  | "getAppState"
  | "getSceneElementsIncludingDeleted"
  | "getSceneElementsMapIncludingDeleted"
  | "updateScene"
>;

export interface PageRuntimeDeps {
  getApi(): PageRuntimeApi | null;
  /** The editor ignores input (interaction off): never touch the scene. */
  isDisabled?(): boolean;
  /** Elements outside every page (0 = none); called when the count changes. */
  onOutsideCount?(count: number): void;
  /** Page mode was switched on or off. */
  onModeChange?(enabled: boolean): void;
}

type Observed = Pick<
  AppState,
  | "pageSetup"
  | "width"
  | "height"
  | "zoom"
  | "scrollX"
  | "scrollY"
  | "scrollConstraints"
  | "viewModeEnabled"
  | "newElement"
  | "resizingElement"
  | "selectedElementsAreBeingDragged"
  | "editingTextElement"
  | "multiElement"
  | "isResizing"
  | "isRotating"
  | "selectedLinearElement"
  | "selectedElementIds"
>;

/** A pointer gesture or text edit is in progress: its result is not committed yet. */
export const isGestureActive = (state: Observed): boolean =>
  !!(
    state.newElement ||
    state.resizingElement ||
    state.selectedElementsAreBeingDragged ||
    state.editingTextElement ||
    state.multiElement ||
    state.isResizing ||
    state.isRotating ||
    state.selectedLinearElement?.isDragging
  );

const geometryKey = (setup: PageSetup | null) =>
  setup ? `${+setup.enabled}${setup.layout}${setup.width}x${setup.height}` : "";

export class PageRuntime {
  private tracker = new VersionTracker();
  private outside = new OutsideIndex();
  private viewMemory: PageViewMemory | null = null;
  private viewSetup: PageSetup | null = null;
  private viewDirty = false;
  private lastWidth = 0;
  private lastHeight = 0;
  private setupKey = "";
  private geometry = "";
  private wasOn = false;
  private needSeed = false;
  private needFull = false;
  private processed: readonly ExcalidrawElement[] | null = null;
  private viewScheduled = false;
  private contentScheduled = false;
  private reportedOutside = 0;
  private disposed = false;

  constructor(private deps: PageRuntimeDeps) {}

  /** Call from the editor's onChange (after it is ready). Cheap when nothing relevant changed. */
  onChange(elements: readonly ExcalidrawElement[], state: Observed): void {
    const setup = state.pageSetup;
    const on = isPageModeOn(setup);
    if (setup !== this.viewSetup) {
      this.onSetupChange(setup, on);
    }
    if (!on && !this.viewMemory) {
      return;
    }
    // view lock: same setup object, window size and a lock in place = nothing to do
    if (
      this.viewDirty ||
      state.width !== this.lastWidth ||
      state.height !== this.lastHeight ||
      state.scrollConstraints === null ||
      !on
    ) {
      this.scheduleView();
    }
    if (
      on &&
      !state.viewModeEnabled &&
      (elements !== this.processed || this.needSeed || this.needFull) &&
      !isGestureActive(state)
    ) {
      this.scheduleContent();
    }
  }

  dispose(): void {
    this.disposed = true;
    setPageDisplay(null);
    setPageStatus(null);
  }

  private onSetupChange(setup: PageSetup | null, on: boolean) {
    this.viewSetup = setup;
    const key = pageSetupKey(setup);
    if (key === this.setupKey) {
      return;
    }
    this.setupKey = key;
    this.viewDirty = true;
    setPageStatus(setup);
    setPageDisplay(
      setup && on
        ? setup.paperTheme === "match"
          ? "match"
          : "identity"
        : null,
      setup ? PAPER_THEME_COLORS[setup.paperTheme].background : null,
    );
    const geometry = geometryKey(setup);
    if (on && (!this.wasOn || geometry !== this.geometry)) {
      // opening / switching on / resizing the pages: judge nothing that is
      // already there (old drawings stay as they are)
      this.needSeed = true;
    }
    if (on) {
      this.needFull = true;
    } else {
      this.outside.clear();
      this.report();
    }
    this.geometry = geometry;
    if (on !== this.wasOn) {
      this.wasOn = on;
      this.deps.onModeChange?.(on);
    }
  }

  private scheduleView() {
    if (this.viewScheduled) {
      return;
    }
    this.viewScheduled = true;
    queueMicrotask(() => {
      this.viewScheduled = false;
      this.applyView();
    });
  }

  private applyView() {
    const api = this.deps.getApi();
    if (this.disposed || !api) {
      return;
    }
    const state = api.getAppState();
    const next = reconcilePageView(state, this.viewMemory);
    this.viewDirty = false;
    this.lastWidth = state.width;
    this.lastHeight = state.height;
    if (!next) {
      return;
    }
    this.viewMemory = next.memory;
    api.updateScene({ appState: next.patch });
  }

  private scheduleContent() {
    if (this.contentScheduled) {
      return;
    }
    this.contentScheduled = true;
    queueMicrotask(() => {
      this.contentScheduled = false;
      this.applyContent();
    });
  }

  private report() {
    const count = this.outside.size;
    if (count !== this.reportedOutside) {
      this.reportedOutside = count;
      this.deps.onOutsideCount?.(count);
    }
  }

  /** One pass over what changed since the last one. */
  applyContent(): void {
    const api = this.deps.getApi();
    if (this.disposed || !api || this.deps.isDisabled?.()) {
      return;
    }
    const state = api.getAppState();
    const setup = state.pageSetup;
    if (
      !isPageModeOn(setup) ||
      state.viewModeEnabled ||
      isGestureActive(state)
    ) {
      return;
    }
    const elements = api.getSceneElementsIncludingDeleted();
    const map = api.getSceneElementsMapIncludingDeleted();
    let changed: readonly ExcalidrawElement[];
    let judged: readonly ExcalidrawElement[];
    if (this.needSeed) {
      this.tracker.seed(elements);
      this.outside.rebuild(setup, elements, map);
      changed = [];
      judged = elements;
    } else {
      changed = this.tracker.diff(elements);
      judged = changed;
    }
    const full = this.needFull || this.needSeed;
    this.needSeed = this.needFull = false;
    this.processed = elements;

    let nextElements: readonly ExcalidrawElement[] = elements;
    let finalMap: ElementsMap = map;
    if (changed.length) {
      nextElements = enforceChanged(
        setup,
        elements,
        changed,
        state.selectedElementIds,
        map,
      );
      if (nextElements !== elements) {
        const moved = nextElements.filter((e, i) => e !== elements[i]);
        const movedIds = new Set(moved.map((e) => e.id));
        this.tracker.mark(moved);
        judged = [...changed.filter((e) => !movedIds.has(e.id)), ...moved];
        finalMap = arrayToMap(nextElements);
      }
      this.outside.update(setup, judged, finalMap);
    }
    const pageCount = getExtendedPageCount(
      setup,
      full ? nextElements : judged,
      finalMap,
    );
    const extended = pageCount > setup.pageCount;
    if (nextElements !== elements || extended) {
      api.updateScene({
        ...(nextElements !== elements ? { elements: nextElements } : {}),
        ...(extended
          ? { appState: { pageSetup: { ...setup, pageCount } } }
          : {}),
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      this.processed = api.getSceneElementsIncludingDeleted();
    }
    this.report();
  }
}
