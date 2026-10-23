import { SceneOpsError, validateOps } from "./rules";

import type {
  Disposable,
  SceneContextApi,
  SceneElement,
  SceneElementType,
  SceneOp,
} from "@vaultdraw/api";
import type { Hooks } from "./panels";
import type {
  FakeBatch,
  FakeElement,
  FakeElementInput,
  FakeScene,
} from "./types";

/** What the scene needs from the host: attribution and disposal. */
export interface ScenePlumbing {
  track(fn: () => void): Disposable;
  guard<A extends unknown[]>(
    fn: (...args: A) => void,
    where: string,
  ): (...args: A) => void;
  logError(text: string): void;
}

type Change = { reason: "edit" | "switch"; path: string | null };

/** The editor's element: the public fields plus the ones the host tracks. */
type El = {
  -readonly [K in keyof FakeElement]: FakeElement[K];
} & { angle: number; version: number; isDeleted?: boolean };

const KNOWN: ReadonlySet<string> = new Set([
  "rectangle",
  "ellipse",
  "diamond",
  "text",
  "arrow",
  "line",
  "freedraw",
  "image",
  "frame",
]);
const CONTAINERS = new Set(["rectangle", "ellipse", "diamond", "arrow"]);
const VIEWPORT = { width: 800, height: 600 };
const EMPTY: readonly SceneElement[] = Object.freeze([]);

/** The scene is viewed through a 800x600 viewport at zoom 1, scrolled to the origin. */
const CENTER = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };

export interface SceneModel {
  fake: FakeScene;
  /** `ctx.scene` of one plugin. */
  api(plumbing: ScenePlumbing, hooks: () => Hooks): SceneContextApi;
  dispose(): void;
}

let clock = 1;
let ids = 0;

const bounds = (els: readonly El[]) => {
  const x1 = Math.min(...els.map((e) => e.x));
  const y1 = Math.min(...els.map((e) => e.y));
  const x2 = Math.max(...els.map((e) => e.x + e.width));
  const y2 = Math.max(...els.map((e) => e.y + e.height));
  return { x1, y1, x2, y2 };
};

const sizeOfPoints = (points: readonly [number, number][]) => ({
  width: Math.max(1, ...points.map((p) => Math.abs(p[0]))),
  height: Math.max(1, ...points.map((p) => Math.abs(p[1]))),
});

const textSize = (text: string, fontSize = 20) => ({
  width: Math.max(1, Math.round(text.length * fontSize * 0.6)),
  height: Math.round(fontSize * 1.25),
});

/** A NewElement as an editor element (a text label becomes its own element). */
const build = (input: FakeElementInput): El[] => {
  const { type, text, id, points, ...rest } = input;
  const base: El = {
    id: id ?? `mock-${++ids}`,
    type,
    x: input.x ?? 0,
    y: input.y ?? 0,
    width: input.width ?? 100,
    height: input.height ?? 100,
    angle: 0,
    strokeColor: input.strokeColor ?? "#1e1e1e",
    backgroundColor: input.backgroundColor ?? "transparent",
    version: ++clock,
  };
  Object.assign(base, rest, { id: base.id, type });
  if (points) {
    Object.assign(base, sizeOfPoints(points));
  }
  if (type === "text") {
    const t = text ?? "";
    Object.assign(base, { text: t }, textSize(t, input.fontSize), {
      backgroundColor: "transparent",
    });
    // An explicit size on a text element is kept.
    Object.assign(base, {
      ...(input.width ? { width: input.width } : {}),
      ...(input.height ? { height: input.height } : {}),
    });
    return [base];
  }
  if (!text || !CONTAINERS.has(type)) {
    return [base];
  }
  const size = textSize(text, input.fontSize);
  const label: El = {
    id: `mock-${++ids}`,
    type: "text",
    text,
    containerId: base.id,
    x: base.x + (base.width - size.width) / 2,
    y: base.y + (base.height - size.height) / 2,
    ...size,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    version: ++clock,
  };
  return [base, label];
};

const isFull = (e: FakeElementInput | FakeElement): e is FakeElement =>
  "version" in e;

/** The fake editor plus the plugin-facing scene API. */
export function createSceneModel(initialPath: string | null): SceneModel {
  let elements: El[] = [];
  let path = initialPath;
  let readOnly = false;
  let version = 0;
  let lastNotified = 0;
  let frame: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<(e: Change) => void>();
  const batches: FakeBatch[] = [];

  const sum = () => elements.reduce((n, e) => n + e.version, 0);
  const live = () => elements.filter((e) => !e.isDeleted);

  const notify = (reason: Change["reason"]) => {
    for (const cb of [...listeners]) {
      cb({ reason, path });
    }
  };
  /** At most one notification per frame, and only when the scene version moved. */
  const onApiChange = () => {
    if (frame !== null || listeners.size === 0) {
      return;
    }
    frame = globalThis.setTimeout(() => {
      frame = null;
      const now = sum();
      if (listeners.size > 0 && now !== lastNotified) {
        lastNotified = now;
        notify("edit");
      }
    }, 0);
  };
  const touch = () => {
    version++;
    onApiChange();
  };

  // Snapshot of the public projection, rebuilt when the scene changes.
  let snapshot: readonly SceneElement[] = EMPTY;
  let snapshotVersion = -1;
  const read = (): readonly SceneElement[] => {
    if (path === null) {
      return EMPTY;
    }
    if (snapshotVersion !== version) {
      snapshot = Object.freeze(
        live().map((el) => {
          const out: { -readonly [K in keyof SceneElement]: SceneElement[K] } =
            {
              id: el.id,
              type: (KNOWN.has(el.type)
                ? el.type
                : "other") as SceneElementType,
              x: el.x,
              y: el.y,
              width: el.width,
              height: el.height,
              angle: el.angle,
            };
          if (el.type === "text") {
            out.text = el.text;
          }
          if (el.strokeColor !== undefined) {
            out.strokeColor = el.strokeColor;
          }
          if (el.backgroundColor !== undefined) {
            out.backgroundColor = el.backgroundColor;
          }
          return Object.freeze(out);
        }),
      );
      snapshotVersion = version;
    }
    return snapshot;
  };

  const fake: FakeScene = {
    setElements(els) {
      elements = els.flatMap((e) => (isFull(e) ? [e as El] : build(e)));
      touch();
    },
    emitChange() {
      elements = elements.map((e) => ({ ...e, version: ++clock }));
      touch();
    },
    switchTo(next) {
      path = next;
      version++;
      lastNotified = sum();
      notify("switch");
    },
    readOnly(flag) {
      readOnly = flag;
    },
    batches,
    live,
  };

  const apply = (ops: readonly SceneOp[]): { ids: string[] } => {
    const byId = new Map(elements.map((e) => [e.id, e]));
    validateOps(ops, byId);
    const adds: FakeElementInput[] = [];
    const edits = new Map<string, El | "delete">();
    for (const op of ops) {
      if (op.op === "add") {
        adds.push(op.element);
      } else if (op.op === "delete") {
        edits.set(op.id, "delete");
      } else if (edits.get(op.id) !== "delete") {
        const base = (edits.get(op.id) as El | undefined) ?? byId.get(op.id)!;
        const next: El = { ...base, version: ++clock };
        const { text, points, ...plain } = op.props;
        Object.assign(next, plain);
        if (points) {
          Object.assign(next, sizeOfPoints(points));
        }
        if (text !== undefined && next.type === "text") {
          Object.assign(next, { text }, textSize(text, op.props.fontSize));
        }
        edits.set(op.id, next);
      }
    }
    // Elements without x/y are shifted as a group onto the viewport centre.
    const built = adds.map((a) => ({ a, els: build(a) }));
    const unplaced = built.filter(
      (b) => b.a.x === undefined || b.a.y === undefined,
    );
    if (unplaced.length > 0) {
      const box = bounds(unplaced.map((b) => b.els[0]));
      const dx = CENTER.x - (box.x1 + box.x2) / 2;
      const dy = CENTER.y - (box.y1 + box.y2) / 2;
      unplaced.forEach((b) =>
        b.els.forEach((e) => {
          e.x += dx;
          e.y += dy;
        }),
      );
    }
    const created = built.flatMap((b) => b.els);
    const merged = elements.map((el) => {
      const edit = edits.get(el.id);
      if (!edit) {
        return el;
      }
      return edit === "delete"
        ? { ...el, isDeleted: true, version: ++clock }
        : edit;
    });
    elements = [...merged, ...created];
    batches.push({
      captureUpdate: "IMMEDIATELY",
      elements: [...elements],
    });
    touch();
    return { ids: created.filter((e) => !e.containerId).map((e) => e.id) };
  };

  return {
    fake,
    api({ track, guard, logError }, hooks) {
      const refusal = (what: string) => {
        const err = new Error(`scene.batch: ${what}`);
        logError(err.message);
        return err;
      };
      const subscribe = (cb: (e: Change) => void) => {
        if (listeners.size === 0) {
          lastNotified = sum();
        }
        listeners.add(cb);
        return () => {
          listeners.delete(cb);
        };
      };
      return {
        elements: read,
        onChange(cb) {
          return track(subscribe(guard(cb, "scene.onChange")));
        },
        useScene<T>(
          select: (els: readonly SceneElement[]) => T,
          isEqual: (a: T, b: T) => boolean = Object.is,
        ): T {
          const { useCallback, useRef, useSyncExternalStore } = hooks();
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
            const els = read();
            const prev = last.current;
            if (prev && prev.els === els && prev.select === sel.current) {
              return prev.value;
            }
            const next = sel.current(els);
            const value =
              prev && eq.current(prev.value, next) ? prev.value : next;
            last.current = { els, select: sel.current, value };
            return value;
          }, []);
          return useSyncExternalStore(
            (onChange) => subscribe(() => onChange()),
            getSnapshot,
          );
        },
        async batch(ops) {
          if (path === null) {
            throw refusal("no drawing is open");
          }
          if (readOnly) {
            throw refusal("the drawing is read-only");
          }
          try {
            return apply(ops);
          } catch (err) {
            if (err instanceof SceneOpsError) {
              logError(`scene.batch: ${err.message}`);
            }
            throw err;
          }
        },
        viewportCenter: () => (path === null ? { x: 0, y: 0 } : { ...CENTER }),
      };
    },
    dispose() {
      if (frame !== null) {
        globalThis.clearTimeout(frame);
        frame = null;
      }
      listeners.clear();
    },
  };
}
