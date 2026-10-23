/**
 * Pure, all-or-nothing validation of a batch of scene ops (nothing is
 * written until every op passes). Unknown props are issues, never ignored.
 */
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { isAllowedColor } from "./colors";
import { SceneOpsError } from "./types";

import type { SceneOp, SceneOpIssue } from "./types";

export const MAX_OPS = 500;
export const MAX_COORD = 1e7;
export const MAX_SIZE = 1e6;
export const MAX_TEXT = 10_000;
const MAX_POINTS = 10_000;

const ADD_TYPES = new Set([
  "rectangle",
  "ellipse",
  "diamond",
  "text",
  "arrow",
  "line",
]);

type Check = (v: unknown) => string | null;

const num =
  (min: number, max: number): Check =>
  (v) =>
    typeof v === "number" && Number.isFinite(v) && v >= min && v <= max
      ? null
      : `must be a finite number in ${min}..${max}`;

const color: Check = (v) =>
  isAllowedColor(v) ? null : "must be a hex colour or a CSS colour name";

const text: Check = (v) =>
  typeof v === "string" && v.length <= MAX_TEXT
    ? null
    : `must be a string of at most ${MAX_TEXT} characters`;

const points: Check = (v) =>
  Array.isArray(v) &&
  v.length <= MAX_POINTS &&
  v.every(
    (p) =>
      Array.isArray(p) &&
      p.length === 2 &&
      p.every(
        (n) =>
          typeof n === "number" &&
          Number.isFinite(n) &&
          Math.abs(n) <= MAX_COORD,
      ),
  )
    ? null
    : `must be at most ${MAX_POINTS} [x, y] pairs of finite numbers`;

/** Properties allowed on add and update (the public NewElement minus type). */
const PROPS: Record<string, Check> = {
  x: num(-MAX_COORD, MAX_COORD),
  y: num(-MAX_COORD, MAX_COORD),
  width: num(1, MAX_SIZE),
  height: num(1, MAX_SIZE),
  text,
  fontSize: num(1, 1000),
  strokeColor: color,
  backgroundColor: color,
  strokeWidth: num(0, 100),
  opacity: num(0, 100),
  points,
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const checkProps = (
  props: Record<string, unknown>,
  op: number,
  issues: SceneOpIssue[],
  skip?: string,
) => {
  for (const key of Object.keys(props)) {
    if (key === skip) {
      continue;
    }
    const check = Object.prototype.hasOwnProperty.call(PROPS, key)
      ? PROPS[key]
      : null;
    if (!check) {
      issues.push({ op, key, message: "unknown property" });
      continue;
    }
    const problem = check(props[key]);
    if (problem) {
      issues.push({ op, key, message: problem });
    }
  }
};

const liveTarget = (
  id: unknown,
  op: number,
  existing: ReadonlyMap<string, ExcalidrawElement>,
  issues: SceneOpIssue[],
  deleted: ReadonlySet<string>,
): ExcalidrawElement | null => {
  const el = typeof id === "string" ? existing.get(id) : undefined;
  if (!el || el.isDeleted) {
    issues.push({ op, key: "id", message: "no such element" });
    return null;
  }
  if (deleted.has(el.id)) {
    issues.push({
      op,
      key: "id",
      message: "element was deleted earlier in this batch",
    });
    return null;
  }
  return el;
};

export const validateOps = (
  ops: unknown,
  existing: ReadonlyMap<string, ExcalidrawElement>,
): SceneOp[] => {
  if (!Array.isArray(ops)) {
    throw new SceneOpsError([{ op: -1, message: "ops must be an array" }]);
  }
  if (ops.length > MAX_OPS) {
    throw new SceneOpsError([
      { op: -1, message: `at most ${MAX_OPS} ops per batch` },
    ]);
  }
  const issues: SceneOpIssue[] = [];
  const deleted = new Set<string>();
  ops.forEach((raw: unknown, i) => {
    if (!isRecord(raw)) {
      issues.push({ op: i, message: "op must be an object" });
      return;
    }
    if (raw.op === "add") {
      const el = raw.element;
      if (!isRecord(el)) {
        issues.push({ op: i, key: "element", message: "must be an object" });
        return;
      }
      if (typeof el.type !== "string" || !ADD_TYPES.has(el.type)) {
        issues.push({
          op: i,
          key: "type",
          message: "unsupported element type",
        });
      }
      checkProps(el, i, issues, "type");
      if (el.type === "text" && typeof el.text !== "string") {
        issues.push({ op: i, key: "text", message: "text elements need text" });
      }
    } else if (raw.op === "update") {
      const target = liveTarget(raw.id, i, existing, issues, deleted);
      if (!isRecord(raw.props)) {
        issues.push({ op: i, key: "props", message: "must be an object" });
        return;
      }
      checkProps(raw.props, i, issues);
      if (target && target.type !== "text") {
        for (const key of ["text", "fontSize"]) {
          if (key in raw.props) {
            issues.push({ op: i, key, message: "only valid on text elements" });
          }
        }
      }
      if (target && target.type !== "arrow" && target.type !== "line") {
        if ("points" in raw.props) {
          issues.push({
            op: i,
            key: "points",
            message: "only valid on lines and arrows",
          });
        }
      }
    } else if (raw.op === "delete") {
      if (liveTarget(raw.id, i, existing, issues, deleted)) {
        deleted.add(raw.id as string);
      }
    } else {
      issues.push({
        op: i,
        key: "op",
        message: "must be add, update or delete",
      });
    }
  });
  if (issues.length) {
    throw new SceneOpsError(issues);
  }
  return ops as SceneOp[];
};
