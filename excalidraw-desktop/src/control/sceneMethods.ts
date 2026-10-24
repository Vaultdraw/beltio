/**
 * Live scene window methods (scene.read, scene.get, scene.selection,
 * scene.apply) over the P2c scene core. Loaded lazily by sceneLazy.ts, never
 * from the startup bundle. Pure: the active scene and the notice are injected.
 */
import { toastStore } from "../toasts/toastStore";
import {
  applyOps,
  MAX_OPS,
  projectScene,
  SceneOpsError,
  validateOps,
} from "../sceneOps";
import { getActiveScene, type ActiveScene } from "../sceneOps/sceneBus";

import { ControlError } from "./errors";
import {
  boolParam,
  EXT,
  objectParams,
  optionalStringParam,
  splitPath,
} from "./params";
import { sceneVersion } from "./sceneVersion";

import type { SceneElement } from "../sceneOps";

type Handler = (params: unknown) => unknown;

export interface SceneDeps {
  active?: () => ActiveScene | null;
  notify?: (message: string) => void;
}

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 2000;
const MAX_GET_IDS = 100;
const SCOPES = ["all", "viewport", "selection"] as const;
type Scope = typeof SCOPES[number];

const invalid = (message: string) =>
  new ControlError("INVALID_PARAMS", message);

const intParam = (
  params: unknown,
  name: string,
  min: number,
  max: number,
  fallback: number,
): number => {
  const v = objectParams(params)[name];
  if (v === undefined) {
    return fallback;
  }
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
    throw invalid(`${name} must be an integer from ${min} to ${max}`);
  }
  return v;
};

const stringList = (
  params: unknown,
  name: string,
  max = Infinity,
  required = false,
): string[] | undefined => {
  const v = objectParams(params)[name];
  if (v === undefined && !required) {
    return undefined;
  }
  if (
    !Array.isArray(v) ||
    v.length > max ||
    (required && v.length === 0) ||
    v.some((s) => typeof s !== "string" || s === "")
  ) {
    throw invalid(
      `${name} must be ${required ? "a non-empty " : "an "}array of strings${
        max === Infinity ? "" : ` (at most ${max})`
      }`,
    );
  }
  return v as string[];
};

const drawingName = (path: string | null): string => {
  if (!path) {
    return "the drawing";
  }
  const { name } = splitPath(path);
  return name.toLowerCase().endsWith(EXT) ? name.slice(0, -EXT.length) : name;
};

const WHO = { cli: "A script", mcp: "AI tools" } as const;

const noticeText = (by: unknown, count: number, path: string | null) => {
  const who = by === "cli" || by === "mcp" ? WHO[by] : "The control API";
  const name = drawingName(path);
  return count === 1
    ? `${who} made 1 change to ${name}. Undo reverts it.`
    : `${who} made ${count} changes to ${name}. Undo reverts them.`;
};

export function createSceneMethods(
  deps: SceneDeps = {},
): Record<string, Handler> {
  const active = deps.active ?? getActiveScene;
  const notify =
    deps.notify ?? ((message: string) => toastStore.push({ message }));

  /** The drawing on screen, or NOT_FOUND. `path` must name that drawing. */
  const resolve = (params: unknown) => {
    const path = optionalStringParam(params, "path");
    const scene = active();
    if (!scene) {
      throw new ControlError("NOT_FOUND", "No drawing is open", {
        reason: "no_drawing",
      });
    }
    if (path !== undefined && path !== scene.path) {
      throw new ControlError(
        "NOT_FOUND",
        "Only the drawing on screen can be read or edited; open it first",
        { reason: "not_active", path },
      );
    }
    return scene;
  };

  const snapshot = (scene: ActiveScene) => {
    const all = scene.api.getSceneElementsIncludingDeleted();
    return { all, elements: projectScene(all), version: sceneVersion(all) };
  };

  const selectedIds = (
    scene: ActiveScene,
    elements: readonly SceneElement[],
  ) => {
    const sel = scene.api.getAppState().selectedElementIds ?? {};
    return elements.filter((e) => sel[e.id]).map((e) => e.id);
  };

  const read: Handler = (params) => {
    const scope = (objectParams(params).scope ?? "all") as Scope;
    if (!SCOPES.includes(scope)) {
      throw invalid("scope must be all, viewport or selection");
    }
    const types = stringList(params, "types");
    const ids = stringList(params, "ids");
    const limit = intParam(params, "limit", 1, MAX_LIMIT, DEFAULT_LIMIT);
    const offset = intParam(params, "offset", 0, Number.MAX_SAFE_INTEGER, 0);
    const scene = resolve(params);
    const { elements, version } = snapshot(scene);
    const app = scene.api.getAppState();
    const zoom = app.zoom.value;
    const viewport = {
      x: -app.scrollX,
      y: -app.scrollY,
      width: app.width / zoom,
      height: app.height / zoom,
      zoom,
    };
    const selection = selectedIds(scene, elements);

    const typeSet = types && new Set(types);
    const idSet = ids && new Set(ids);
    const selSet = scope === "selection" ? new Set(selection) : null;
    const matches = elements.filter((e) => {
      if (typeSet && !typeSet.has(e.type)) {
        return false;
      }
      if (idSet && !idSet.has(e.id)) {
        return false;
      }
      if (selSet && !selSet.has(e.id)) {
        return false;
      }
      if (scope === "viewport") {
        return (
          e.x + e.width >= viewport.x &&
          e.x <= viewport.x + viewport.width &&
          e.y + e.height >= viewport.y &&
          e.y <= viewport.y + viewport.height
        );
      }
      return true;
    });
    const counts: Record<string, number> = {};
    for (const e of matches) {
      counts[e.type] = (counts[e.type] ?? 0) + 1;
    }
    const page = matches.slice(offset, offset + limit);
    return {
      path: scene.path,
      live: true,
      readOnly: scene.readOnly,
      version,
      total: matches.length,
      returned: page.length,
      truncated: offset + page.length < matches.length,
      counts,
      elements: page,
      selection,
      viewport,
    };
  };

  const get: Handler = (params) => {
    const ids = stringList(params, "ids", MAX_GET_IDS, true)!;
    const scene = resolve(params);
    const { elements, version } = snapshot(scene);
    const byId = new Map(elements.map((e) => [e.id, e]));
    const found: SceneElement[] = [];
    const missing: string[] = [];
    for (const id of ids) {
      const el = byId.get(id);
      if (el) {
        found.push(el);
      } else {
        missing.push(id);
      }
    }
    return { path: scene.path, version, elements: found, missing };
  };

  const selection: Handler = (params) => {
    const scene = resolve(params);
    const { elements, version } = snapshot(scene);
    const ids = selectedIds(scene, elements);
    const set = new Set(ids);
    return {
      path: scene.path,
      version,
      ids,
      elements: elements.filter((e) => set.has(e.id)),
    };
  };

  const apply: Handler = (params) => {
    const p = objectParams(params);
    const ops = p.ops;
    if (!Array.isArray(ops) || ops.length < 1 || ops.length > MAX_OPS) {
      throw invalid(`ops must be an array of 1 to ${MAX_OPS} operations`);
    }
    const ifVersion = optionalStringParam(params, "ifVersion");
    const dryRun = boolParam(params, "dryRun", false);
    const notifyEdit = boolParam(params, "notify", true);
    const by = p.by;
    if (by !== undefined && by !== "cli" && by !== "mcp" && by !== "uri") {
      throw invalid("by must be cli, mcp or uri");
    }
    const scene = resolve(params);
    if (scene.readOnly) {
      throw new ControlError("READ_ONLY", "The drawing is read-only");
    }
    const before = snapshot(scene);
    if (ifVersion !== undefined && ifVersion !== before.version) {
      throw new ControlError(
        "CONFLICT",
        "The drawing changed since it was read",
        { reason: "version", current: before.version },
      );
    }
    try {
      if (dryRun) {
        validateOps(ops, new Map(before.all.map((e) => [e.id, e])));
        return {
          path: scene.path,
          live: true,
          dryRun: true,
          applied: 0,
          valid: true,
          version: before.version,
        };
      }
      const { ids } = applyOps(scene.api, ops);
      if (notifyEdit) {
        notify(noticeText(by, ops.length, scene.path));
      }
      return {
        path: scene.path,
        live: true,
        applied: ops.length,
        ids,
        version: sceneVersion(scene.api.getSceneElementsIncludingDeleted()),
      };
    } catch (e) {
      if (e instanceof SceneOpsError) {
        throw new ControlError("INVALID_PARAMS", e.message, {
          issues: e.issues,
        });
      }
      throw e;
    }
  };

  return {
    "scene.read": read,
    "scene.get": get,
    "scene.selection": selection,
    "scene.apply": apply,
  };
}
