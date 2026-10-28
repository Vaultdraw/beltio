import { PluginApiError } from "../shared/rules";
import {
  imageBudget,
  imageDataUrlBytes,
  IMAGE_ELEMENT_BYTES,
  isBytes,
  MAX_IMAGE_BYTES,
  SceneOpsError,
  validateOps,
} from "../shared/sceneRules";

import type {
  BatchResult,
  Disposable,
  Json,
  NewElement,
  SceneContextApi,
  SceneElement,
  SceneElementDetail,
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

const sha1Hex = async (bytes: Uint8Array): Promise<string> =>
  Array.from(
    new Uint8Array(
      await globalThis.crypto.subtle.digest("SHA-1", bytes as BufferSource),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");

/** SHA-1 of every image add of `ops` (the editor names files this way). Unvalidated input: only plausible ones. */
const hashImages = async (ops: unknown): Promise<Map<object, string>> => {
  const out = new Map<object, string>();
  if (!Array.isArray(ops)) {
    return out;
  }
  for (const op of ops) {
    const image = op?.op === "update" ? op.props?.image : op?.element?.image;
    if (
      (op?.op === "update" ||
        (op?.op === "add" && op.element?.type === "image")) &&
      isBytes(image?.bytes) &&
      image.bytes.length <= MAX_IMAGE_BYTES
    ) {
      out.set(op, await sha1Hex(image.bytes));
    }
  }
  return out;
};

/** What the scene needs from the host: attribution and disposal. */
export interface ScenePlumbing {
  track(fn: () => void): Disposable;
  guard<A extends unknown[]>(
    fn: (...args: A) => void,
    where: string,
  ): (...args: A) => void;
  logError(text: string): void;
  /** The plugin's customData key (`ctx.manifest.dataKey`). */
  dataKey?: string;
}

type Change = { reason: "edit" | "switch"; path: string | null };

/** The editor's element: the public fields plus the ones the host tracks. */
type El = {
  -readonly [K in keyof FakeElement]: FakeElement[K];
} & {
  angle: number;
  version: number;
  isDeleted?: boolean;
  groupIds?: string[];
  customData?: Record<string, unknown>;
  [key: string]: unknown;
};

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
  /** Adds editor elements (a page document's frame) and merges app state. */
  append(
    elements: readonly FakeElement[],
    appState?: Record<string, unknown>,
  ): void;
  /** Replaces the app state (a load). */
  setAppState(appState: Record<string, unknown>): void;
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
const build = (
  input: FakeElementInput,
  dataKey?: string,
  fileId?: string,
): El[] => {
  const {
    image: _image,
    type,
    text,
    id,
    points,
    data,
    start: _start,
    end: _end,
    roundness,
    ...rest
  } = input;
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
  Object.assign(base, rest, { id: base.id, type, groupIds: [] });
  if (roundness) {
    base.roundness = roundness;
  }
  if (data !== undefined && data !== null && dataKey) {
    base.customData = { [dataKey]: structuredClone(data) };
  }
  if (type === "image") {
    base.fileId = fileId ?? null;
  }
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
    groupIds: [],
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
export function createSceneModel(
  initialPath: string | null,
  /** `plugins.scene_max_ops` of the test (undefined: the app's default). */
  maxOps: () => number | undefined = () => undefined,
): SceneModel {
  let elements: El[] = [];
  let path = initialPath;
  let readOnly = false;
  let version = 0;
  let lastNotified = 0;
  let frame: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<(e: Change) => void>();
  const batches: FakeBatch[] = [];
  let appState: Record<string, unknown> = {};
  const scrolled: string[] = [];
  /** Pictures of the drawing by SHA-1 (what the editor's file store holds). */
  const files = new Map<string, { mime: string; bytes: Uint8Array }>();

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
    files: () =>
      Object.fromEntries(
        [...files].map(([id, f]) => [
          id,
          { mime: f.mime, bytes: new Uint8Array(f.bytes) },
        ]),
      ),
    scrolledTo: () => [...scrolled],
    select(ids) {
      appState = {
        ...appState,
        selectedElementIds: Object.fromEntries(ids.map((id) => [id, true])),
      };
    },
    strokeColor(color) {
      appState = { ...appState, currentItemStrokeColor: color };
    },
    appState: () => ({ ...appState }),
  };

  let groupSeq = 0;
  const apply = (
    ops: readonly SceneOp[],
    dataKey?: string,
    hashes?: ReadonlyMap<object, string>,
  ): BatchResult => {
    const byId = new Map(elements.map((e) => [e.id, e]));
    validateOps(ops, byId, {
      dataKey: dataKey ?? null,
      allowImages: hashes !== undefined,
      maxOps: maxOps(),
    });
    const fileIds = new Map<object, string>();
    const fresh = new Map<string, { mime: string; bytes: Uint8Array }>();
    let imageCount = 0;
    for (const op of ops) {
      const picture =
        op.op === "add" && op.element.type === "image"
          ? op.element.image
          : op.op === "update"
          ? op.props.image
          : undefined;
      if (picture) {
        const id = hashes?.get(op);
        if (!id) {
          throw new PluginApiError("INVALID_ARGUMENT", "image was not hashed");
        }
        fileIds.set(op, id);
        imageCount++;
        if (!files.has(id) && !fresh.has(id)) {
          fresh.set(id, picture);
        }
      }
    }
    if (imageCount) {
      let current = JSON.stringify(live()).length;
      for (const f of files.values()) {
        current += imageDataUrlBytes(f.mime, f.bytes.length);
      }
      let added = imageCount * IMAGE_ELEMENT_BYTES;
      for (const f of fresh.values()) {
        added += imageDataUrlBytes(f.mime, f.bytes.length);
      }
      if (added > imageBudget(current)) {
        throw new PluginApiError(
          "TOO_LARGE",
          "the images would push the drawing past its size cap",
        );
      }
      for (const [id, f] of fresh) {
        files.set(id, { mime: f.mime, bytes: new Uint8Array(f.bytes) });
      }
    }
    const adds: Extract<SceneOp, { op: "add" }>[] = [];
    const groups: Extract<SceneOp, { op: "group" }>[] = [];
    const edits = new Map<string, El | "delete">();
    for (const op of ops) {
      if (op.op === "add") {
        adds.push(op);
      } else if (op.op === "group") {
        groups.push(op);
      } else if (op.op === "delete") {
        edits.set(op.id, "delete");
      } else if (edits.get(op.id) !== "delete") {
        const base = (edits.get(op.id) as El | undefined) ?? byId.get(op.id)!;
        const next: El = { ...base, version: ++clock };
        const { text, points, data, image, ...plain } = op.props;
        Object.assign(next, plain);
        if (image) {
          next.fileId = fileIds.get(op);
        }
        if (points) {
          Object.assign(next, sizeOfPoints(points));
        }
        if (text !== undefined && next.type === "text") {
          Object.assign(next, { text }, textSize(text, op.props.fontSize));
        }
        if (data !== undefined && dataKey) {
          const custom = { ...next.customData };
          if (data === null) {
            delete custom[dataKey];
          } else {
            custom[dataKey] = structuredClone(data);
          }
          next.customData = custom;
        }
        edits.set(op.id, next);
      }
    }
    // Elements without x/y are shifted as a group onto the viewport centre.
    const built = adds.map((a) => ({
      a: a.element,
      els: build(a.element, dataKey, fileIds.get(a)),
    }));
    const refs: Record<string, string> = {};
    adds.forEach((a, i) => {
      if (a.ref !== undefined) {
        refs[a.ref] = built[i].els[0].id;
      }
    });
    // A bound arrow records what it is bound to (the editor computes the
    // geometry); its target lists the arrow in boundElements, as the editor's
    // binding does, for new elements and elements on the canvas alike.
    const endId = (end: NonNullable<NewElement["start"]>) =>
      "ref" in end ? refs[end.ref] : end.id;
    const freshById = new Map(built.map((b) => [b.els[0].id, b.els[0]]));
    built.forEach(({ a, els }) => {
      for (const [key, end] of [
        ["startId", a.start],
        ["endId", a.end],
      ] as const) {
        if (!end) {
          continue;
        }
        const id = endId(end);
        els[0][key] = id;
        const arrowRef = { id: els[0].id, type: "arrow" };
        const fresh = freshById.get(id);
        if (fresh) {
          fresh.boundElements = [
            ...((fresh.boundElements as object[] | undefined) ?? []),
            arrowRef,
          ];
        } else {
          const base = (edits.get(id) as El | undefined) ?? byId.get(id)!;
          edits.set(id, {
            ...base,
            boundElements: [
              ...((base.boundElements as object[] | undefined) ?? []),
              arrowRef,
            ],
            version: ++clock,
          });
        }
      }
    });
    // An arrow bound only to elements on the canvas is drawn from them, so it
    // is not centred with the rest (as in the app).
    const onCanvasOnly = (e: NewElement) =>
      (e.start || e.end) &&
      ![e.start, e.end].some((end) => end && "ref" in end);
    const unplaced = built.filter(
      (b) => (b.a.x === undefined || b.a.y === undefined) && !onCanvasOnly(b.a),
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
    let merged = elements.map((el) => {
      const edit = edits.get(el.id);
      if (!edit) {
        return el;
      }
      return edit === "delete"
        ? { ...el, isDeleted: true, version: ++clock }
        : edit;
    });
    const all = [...merged, ...created];
    for (const g of groups) {
      const groupId = `mock-group-${++groupSeq}`;
      const members = new Set(
        g.ids.map((m) => (typeof m === "string" ? m : refs[m.ref])),
      );
      // A member already in a group brings its whole outermost group, as the
      // app (and Excalidraw's Group action) does.
      const outer = new Set<string>();
      for (const e of all) {
        const top = e.groupIds?.[e.groupIds.length - 1];
        if (members.has(e.id) && top) {
          outer.add(top);
        }
      }
      for (let k = 0; k < all.length; k++) {
        const e = all[k];
        const top = e.groupIds?.[e.groupIds.length - 1];
        if (
          !e.isDeleted &&
          (members.has(e.id) ||
            (e.containerId && members.has(e.containerId)) ||
            (top !== undefined && outer.has(top)))
        ) {
          all[k] = {
            ...e,
            groupIds: [...(e.groupIds ?? []), groupId],
            version: ++clock,
          };
        }
      }
    }
    merged = all;
    elements = merged;
    batches.push({
      captureUpdate: "IMMEDIATELY",
      elements: [...elements],
    });
    touch();
    return {
      ids: built.map((b) => b.els[0].id),
      refs,
    };
  };

  /** `scene.get`'s copy of one element (the fields the mock tracks). */
  const detail = (
    el: El,
    opts: { points?: boolean; data?: boolean },
    dataKey?: string,
  ): SceneElementDetail => {
    const out: Record<string, unknown> = {
      id: el.id,
      type: KNOWN.has(el.type) ? el.type : "other",
      x: el.x,
      y: el.y,
      width: el.width,
      height: el.height,
      angle: el.angle,
      groupIds: [...(el.groupIds ?? [])],
      frameId: null,
      containerId: el.containerId ?? null,
      locked: (el.locked as boolean | undefined) ?? false,
      link: (el.link as string | null | undefined) ?? null,
      opacity: (el.opacity as number | undefined) ?? 100,
      strokeWidth: (el.strokeWidth as number | undefined) ?? 2,
      strokeStyle: (el.strokeStyle as string | undefined) ?? "solid",
      fillStyle: (el.fillStyle as string | undefined) ?? "solid",
      roundness: el.roundness === "round" ? "round" : "sharp",
    };
    if (el.type === "text") {
      out.text = el.text;
      out.fontSize = (el.fontSize as number | undefined) ?? 20;
      out.fontFamily = (el.fontFamily as string | undefined) ?? "Excalifont";
    }
    if (el.strokeColor !== undefined) {
      out.strokeColor = el.strokeColor;
    }
    if (el.backgroundColor !== undefined) {
      out.backgroundColor = el.backgroundColor;
    }
    if (opts.points && (el.type === "line" || el.type === "arrow")) {
      out.points = (
        (el.points as [number, number][] | undefined) ?? [
          [0, 0],
          [el.width, el.height],
        ]
      ).map((p) => [p[0], p[1]]);
    }
    if (opts.data && dataKey && el.customData?.[dataKey] !== undefined) {
      out.data = structuredClone(el.customData[dataKey]);
    }
    return out as unknown as SceneElementDetail;
  };

  return {
    fake,
    append(els, next) {
      elements = [...elements, ...(els as unknown as El[])];
      if (next) {
        appState = { ...appState, ...next };
      }
      touch();
    },
    setAppState(next) {
      appState = { ...next };
    },
    api({ track, guard, logError, dataKey }, hooks) {
      const refusal = (what: string, code?: string) => {
        const text = `scene.batch: ${what}`;
        const err = code ? new PluginApiError(code, text) : new Error(text);
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
        async batch(ops, options) {
          if (path === null) {
            throw refusal("no drawing is open", "NOT_FOUND");
          }
          if (options?.path !== undefined && options.path !== path) {
            throw refusal(
              `another drawing is active than "${String(options.path)}"`,
              "DRAWING_CHANGED",
            );
          }
          if (readOnly) {
            throw refusal("the drawing is read-only", "READ_ONLY");
          }
          const hashes = await hashImages(ops);
          if (path === null) {
            throw refusal("no drawing is open", "NOT_FOUND");
          }
          if (readOnly) {
            throw refusal("the drawing is read-only", "READ_ONLY");
          }
          try {
            return apply(ops, dataKey, hashes);
          } catch (err) {
            if (err instanceof SceneOpsError) {
              logError(`scene.batch: ${err.message}`);
            }
            throw err;
          }
        },
        viewportCenter: () => (path === null ? { x: 0, y: 0 } : { ...CENTER }),
        get(ids, options) {
          if (path === null || !Array.isArray(ids)) {
            return [];
          }
          const byId = new Map(live().map((e) => [e.id, e]));
          const seen = new Set<string>();
          const out: SceneElementDetail[] = [];
          for (const id of ids) {
            const el = byId.get(id);
            if (el && !seen.has(id)) {
              seen.add(id);
              out.push(detail(el, options ?? {}, dataKey));
            }
          }
          return out;
        },
        dataOf(id) {
          if (path === null || !dataKey) {
            return undefined;
          }
          const el = live().find((e) => e.id === id);
          const value = el?.customData?.[dataKey];
          return value === undefined
            ? undefined
            : (structuredClone(value) as Json);
        },
        path: () => path,
        selection: () =>
          path === null
            ? []
            : Object.keys(
                (appState.selectedElementIds as Record<string, true>) ?? {},
              ),
        currentStrokeColor: () =>
          (appState.currentItemStrokeColor as string | undefined) ?? "#1e1e1e",
        scrollTo(id) {
          if (path === null || typeof id !== "string") {
            return;
          }
          scrolled.push(id);
        },
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
