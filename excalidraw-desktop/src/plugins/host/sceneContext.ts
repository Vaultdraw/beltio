/** `ctx.scene` and `ctx.events` of one plugin (split out of context.ts). */
import { useCallback, useRef, useSyncExternalStore } from "react";

import { appEvents, type AppEventMap } from "../../events/appEvents";
import { applyOps, SceneOpsError, viewportCenter } from "../../sceneOps";
import { getActiveScene, subscribeScene } from "../../sceneOps/sceneBus";

import { errorText, logLine, reportPluginError } from "./errors";
import { guard } from "./guard";
import { readScene } from "./sceneRead";

import type { Disposable, PluginContext, SceneElement } from "../api";

type Track = (fn: () => void) => Disposable;

const NOOP: Disposable = { dispose() {} };

/** Compile-time complete list of the app event names. */
const EVENT_NAMES: Record<keyof AppEventMap, true> = {
  "vault.opened": true,
  "drawing.opened": true,
  "drawing.saved": true,
  "drawing.renamed": true,
  "drawing.deleted": true,
};

const subscribeHook = (onStoreChange: () => void) =>
  subscribeScene(() => onStoreChange());

function useScene<T>(
  select: (els: readonly SceneElement[]) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const sel = useRef(select);
  const eq = useRef(isEqual);
  sel.current = select;
  eq.current = isEqual;
  const last = useRef<{
    els: readonly SceneElement[];
    select: typeof select;
    value: T;
  } | null>(null);
  const getSnapshot = useCallback((): T => {
    const els = readScene();
    const prev = last.current;
    if (prev && prev.els === els && prev.select === sel.current) {
      return prev.value;
    }
    const next = sel.current(els);
    const value = prev && eq.current(prev.value, next) ? prev.value : next;
    last.current = { els, select: sel.current, value };
    return value;
  }, []);
  return useSyncExternalStore(subscribeHook, getSnapshot);
}

export function createSceneApi(
  id: string,
  track: Track,
): PluginContext["scene"] {
  const refusal = (what: string) => {
    const err = new Error(`scene.batch: ${what}`);
    logLine(id, "error", errorText(err));
    return err;
  };
  return {
    elements: readScene,
    onChange(cb) {
      const safe = guard(id, cb, "scene.onChange", true);
      return track(subscribeScene(safe));
    },
    useScene,
    async batch(ops) {
      const scene = getActiveScene();
      if (!scene) {
        throw refusal("no drawing is open");
      }
      if (scene.readOnly) {
        throw refusal("the drawing is read-only");
      }
      try {
        return applyOps(scene.api, ops);
      } catch (err) {
        if (err instanceof SceneOpsError) {
          logLine(id, "error", `scene.batch: ${errorText(err)}`);
        }
        throw err;
      }
    },
    viewportCenter() {
      const scene = getActiveScene();
      return scene ? viewportCenter(scene.api.getAppState()) : { x: 0, y: 0 };
    },
  };
}

export function createEventsApi(
  id: string,
  track: Track,
): PluginContext["events"] {
  // One microtask queue per plugin: emission order is kept across event names
  // and a burst never runs inside the emitter.
  let queue: (() => void)[] = [];
  let scheduled = false;
  const drain = () => {
    scheduled = false;
    const run = queue;
    queue = [];
    run.forEach((job) => job());
  };
  return {
    on(name, cb) {
      if (!Object.hasOwn(EVENT_NAMES, name)) {
        reportPluginError(
          id,
          new Error(`unknown event "${String(name)}"`),
          "events.on",
        );
        return NOOP;
      }
      const safe = guard(id, cb, `events.${name}`, true);
      let live = true;
      const off = appEvents.on(name, (payload) => {
        queue.push(() => live && safe(payload));
        if (!scheduled) {
          scheduled = true;
          queueMicrotask(drain);
        }
      });
      return track(() => {
        live = false;
        off();
      });
    },
  };
}
