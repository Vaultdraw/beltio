/**
 * The pure rules of the host, written again for the mock (setting validation,
 * toast prefix and de-duplication, scene op validation). `mockParity.test.ts`
 * runs the same cases through the real code and through this file, so a drift
 * fails a test.
 */
import type { SceneOp, SceneOpIssue, SettingDecl } from "@vaultdraw/api";

/** Errors a plugin may cause before the host switches it off. */
export const MAX_PLUGIN_ERRORS = 3;

// --- settings -------------------------------------------------------------

const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

const inBounds = (decl: SettingDecl, n: number): string | null =>
  (decl.min !== undefined && n < decl.min) ||
  (decl.max !== undefined && n > decl.max)
    ? `a number between ${decl.min ?? "-inf"} and ${decl.max ?? "inf"}`
    : null;

/** null when `value` is valid for `decl`, else what was expected. */
const expectedFor = (decl: SettingDecl, value: unknown): string | null => {
  switch (decl.type) {
    case "bool":
      return typeof value === "boolean" ? null : "true or false";
    case "int":
    case "number": {
      const isInt = decl.type === "int";
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        (isInt && !Number.isInteger(value))
      ) {
        return isInt ? "a whole number" : "a number";
      }
      return inBounds(decl, value);
    }
    case "string":
      return typeof value === "string" ? null : "text";
    case "select":
      return decl.options?.some((o) => o.value === value)
        ? null
        : `one of ${(decl.options ?? [])
            .map((o) => `"${o.value}"`)
            .join(", ")}`;
    case "color":
      return typeof value === "string" && HEX_COLOR.test(value)
        ? null
        : "a hex colour like #1e1e1e";
  }
};

export type SettingValidation =
  | { ok: true; value: string | number | boolean }
  | { ok: false; problem: string };

/** Checks a value against its declaration (same rules and wording as the app). */
export const validateSettingValue = (
  decl: SettingDecl,
  value: unknown,
): SettingValidation => {
  const expected = expectedFor(decl, value);
  return expected === null
    ? { ok: true, value: value as string | number | boolean }
    : { ok: false, problem: `${decl.key}: expected ${expected}` };
};

export const allowsScope = (decl: SettingDecl, scope: "global" | "vault") =>
  (decl.scope ?? ["global", "vault"]).includes(scope);

/** A declaration the host accepts: a valid default. */
export const declProblem = (decl: SettingDecl): string | null => {
  const bad = expectedFor(decl, decl.default);
  return bad ? `${decl.key}: default must be ${bad}` : null;
};

/** A stored value that fails its declaration is skipped; the default stands. */
export const effectiveSetting = (
  decl: SettingDecl,
  global: unknown,
): string | number | boolean =>
  global !== undefined &&
  allowsScope(decl, "global") &&
  validateSettingValue(decl, global).ok
    ? (global as string | number | boolean)
    : decl.default;

// --- toasts ---------------------------------------------------------------

export const MAX_VISIBLE_TOASTS = 3;

export interface MockToast {
  message: string;
  kind: "info" | "error";
}

/** What a plugin's `ui.toast` shows: the plugin name, a colon, the message. */
export const toastMessage = (pluginName: string, message: unknown): string =>
  `${pluginName}: ${String(message)}`;

/** The same message still showing is not stacked; beyond three the oldest goes. */
export const pushToast = (
  queue: readonly MockToast[],
  toast: MockToast,
): MockToast[] =>
  queue.some((t) => t.message === toast.message && t.kind === toast.kind)
    ? [...queue]
    : [...queue, toast].slice(-MAX_VISIBLE_TOASTS);

// --- declared contributions -----------------------------------------------

/** The error when a plugin registers something plugin.toml does not declare. */
export const undeclaredMessage = (what: "command" | "panel", short: string) =>
  `${what} "${short}" is not declared in plugin.toml`;

// --- scene ops ------------------------------------------------------------

export const MAX_OPS = 500;
export const MAX_COORD = 1e7;
export const MAX_SIZE = 1e6;
export const MAX_TEXT = 10_000;
const MAX_POINTS = 10_000;

/** Thrown before anything is written; lists every problem found. */
export class SceneOpsError extends Error {
  readonly issues: SceneOpIssue[];

  constructor(issues: SceneOpIssue[]) {
    super(
      issues
        .map((i) => `op ${i.op}${i.key ? ` (${i.key})` : ""}: ${i.message}`)
        .join("; "),
    );
    this.name = "SceneOpsError";
    this.issues = issues;
  }
}

const NAMED = new Set(
  "transparent aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen".split(
    " ",
  ),
);

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

const isAllowedColor = (v: unknown): v is string =>
  typeof v === "string" && (HEX.test(v) || NAMED.has(v.toLowerCase()));

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

/** The part of an element the op rules look at. */
export interface OpTarget {
  type: string;
  isDeleted?: boolean;
}

const liveTarget = (
  id: unknown,
  op: number,
  existing: ReadonlyMap<string, OpTarget>,
  issues: SceneOpIssue[],
): OpTarget | null => {
  const el = typeof id === "string" ? existing.get(id) : undefined;
  if (!el || el.isDeleted) {
    issues.push({ op, key: "id", message: "no such element" });
    return null;
  }
  return el;
};

/** All-or-nothing validation of a batch (nothing is written until every op passes). */
export const validateOps = (
  ops: unknown,
  existing: ReadonlyMap<string, OpTarget>,
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
      const target = liveTarget(raw.id, i, existing, issues);
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
      liveTarget(raw.id, i, existing, issues);
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

// --- ctx.storage: the key-value rules (the app imports these, so the mock and the app agree) ---

/** Longest key, in characters. */
export const STORAGE_MAX_KEY = 256;
/** Default limit per plugin (`plugins.storage_limit_kb`). */
export const STORAGE_DEFAULT_LIMIT_KB = 1024;
const MAX_DEPTH = 64;

/** An error with a `code`, as the app's API errors have (`QUOTA`, `INVALID_ARGUMENT`, …). */
export class PluginApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PluginApiError";
    this.code = code;
  }
}

const isPlain = (v: object) => {
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

const isJson = (v: unknown, depth: number, seen: Set<object>): boolean => {
  if (v === null || typeof v === "boolean" || typeof v === "string") {
    return true;
  }
  if (typeof v === "number") {
    return Number.isFinite(v);
  }
  if (typeof v !== "object" || depth > MAX_DEPTH || seen.has(v)) {
    return false;
  }
  seen.add(v);
  const ok = Array.isArray(v)
    ? v.every((x) => isJson(x, depth + 1, seen))
    : isPlain(v) &&
      Object.values(v as Record<string, unknown>).every((x) =>
        isJson(x, depth + 1, seen),
      );
  seen.delete(v);
  return ok;
};

/** Throws INVALID_ARGUMENT unless `key` is a non-empty string of at most 256 characters. */
export const checkStorageKey = (key: unknown): string => {
  if (typeof key !== "string" || key.length === 0) {
    throw new PluginApiError(
      "INVALID_ARGUMENT",
      "A storage key must be a non-empty string",
    );
  }
  if (key.length > STORAGE_MAX_KEY) {
    throw new PluginApiError(
      "INVALID_ARGUMENT",
      `A storage key has at most ${STORAGE_MAX_KEY} characters`,
    );
  }
  return key;
};

/** The JSON text of `value`; throws INVALID_ARGUMENT when it is not plain JSON. */
export const encodeStorageValue = (key: string, value: unknown): string => {
  if (!isJson(value, 0, new Set())) {
    throw new PluginApiError(
      "INVALID_ARGUMENT",
      `The value of "${key}" is not JSON (no undefined, functions, class instances, NaN, Infinity or cycles; at most ${MAX_DEPTH} levels deep)`,
    );
  }
  return JSON.stringify(value);
};

/** UTF-8 byte length of `s` without encoding it. */
export const utf8Length = (s: string): number => {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) {
      n += 1;
    } else if (c < 0x800) {
      n += 2;
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      n += 4;
      i++;
    } else {
      n += 3;
    }
  }
  return n;
};

/** Bytes one entry adds to the stored object: `"key":value,`. */
export const storageEntryBytes = (key: string, text: string): number =>
  utf8Length(JSON.stringify(key)) + utf8Length(text) + 2;

/** The stored object's text: entries in insertion order. */
export const composeStorage = (
  entries: ReadonlyMap<string, string>,
): string => {
  let out = "{";
  let first = true;
  for (const [k, v] of entries) {
    out += `${first ? "" : ","}${JSON.stringify(k)}:${v}`;
    first = false;
  }
  return `${out}}`;
};

/** Throws QUOTA when `bytes` (the object's size, `{}` included) passes `limitKb`. */
export const checkStorageQuota = (bytes: number, limitKb: number): void => {
  if (bytes > limitKb * 1024) {
    throw new PluginApiError(
      "QUOTA",
      `Plugin storage is limited to ${limitKb} KiB (plugins.storage_limit_kb)`,
    );
  }
};
