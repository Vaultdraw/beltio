/** `ctx.scene` and `ctx.events` of one plugin (split out of context.ts). */
import { useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";

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
  "vault.changed": true,
};

const subscribeHook = (onStoreChange: () => void) =>
  subscribeScene(() => onStoreChange());

function useScene<T>(
  select: (els: readonly SceneElement[]) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  // The last value handed out, so an equal result keeps its identity across renders.
  // Written in a layout effect, never during render.
  const prev = useRef<{ value: T } | null>(null);
  const getSnapshot = useMemo(() => {
    let els: readonly SceneElement[] | null = null;
    let memo: T;
    return (): T => {
      const now = readScene();
      if (els === now) {
        return memo;
      }
      const next = select(now);
      const before = prev.current;
      memo = before && isEqual(before.value, next) ? before.value : next;
      els = now;
      return memo;
    };
  }, [select, isEqual]);
  const value = useSyncExternalStore(subscribeHook, getSnapshot);
  useLayoutEffect(() => {
    prev.current = { value };
  }, [value]);
  return value;
}

export function createSceneApi(
  id: string,
  track: Track,
  isLive: () => boolean = () => true,
): PluginContext["scene"] {
  const refusal = (what: string) => {
    const err = new Error(`scene.batch: ${what}`);
    logLine(id, "error", errorText(err));
    return err;
  };
  return {
    elements: readScene,
    onChange(cb) {
      if (!isLive()) {
        return NOOP;
      }
      const safe = guard(id, cb, "scene.onChange", true);
      return track(subscribeScene(safe));
    },
    useScene,
    async batch(ops) {
      if (!isLive()) {
        throw refusal("the plugin was stopped");
      }
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
  isLive: () => boolean = () => true,
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
      if (!isLive()) {
        return NOOP;
      }
      const safe = guard(id, cb, `events.${name}`, true);
      let live = true;
      const enqueue = (payload: unknown) => {
        queue.push(() => live && safe(payload as never));
        if (!scheduled) {
          scheduled = true;
          queueMicrotask(drain);
        }
      };
      const off = appEvents.on(name, enqueue);
      // A plugin that activates after the vault or drawing opened is told the current state once.
      const now = appEvents.current(name);
      if (now !== undefined) {
        enqueue(now);
      }
      return track(() => {
        live = false;
        off();
      });
    },
  };
}
