/**
 * The pure rules of scene ops: one copy, used by the app (`src/sceneOps`),
 * the control API and the mock host, so they can never drift. All-or-nothing:
 * nothing is written until every op passes. Unknown props are issues, never
 * ignored. No editor imports here: the app maps names (fonts, roundness) to
 * the editor's values when it builds elements.
 */
import { isJsonValue, utf8Length } from "./rules";

import type { SceneOp, SceneOpIssue } from "@vaultdraw/api";

/** Default and hard ceiling of ops per batch (`plugins.scene_max_ops`). */
export const MAX_OPS = 500;
export const MAX_OPS_LIMIT = 1000;
export const MAX_COORD = 1e7;
export const MAX_SIZE = 1e6;
export const MAX_TEXT = 10_000;
/** Largest `data` of one element, as UTF-8 JSON. */
export const MAX_DATA_BYTES = 4096;
/** Largest single image, in bytes. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** Mirrors the native drawing cap (src-tauri/src/lib.rs MAX_DRAWING_BYTES). */
export const MAX_DRAWING_BYTES = 32 * 1024 * 1024;
/** Share of the cap an image batch may fill (room left for edits and annotations). */
export const DRAWING_BYTES_HEADROOM = 0.9;
/** Element JSON of one image. */
export const IMAGE_ELEMENT_BYTES = 250;
/** Image types a plugin may add (what the editor and the exports handle). */
export const IMAGE_MIMES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
] as const;
const MAX_POINTS = 10_000;
const MAX_LINK = 2048;
const REF = /^[A-Za-z0-9_.:-]{1,64}$/;
/** A declared data key: lower case words joined by `.`, `_` or `-`. */
const DATA_KEY = /^[a-z][a-z0-9_-]*(\.[a-z0-9_-]+)*$/;
const MAX_DATA_KEY = 64;

/** Thrown before anything is written; lists every problem found. */
export class SceneOpsError extends Error {
  readonly code = "INVALID_ARGUMENT";
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

/** Font names a plugin may use (Excalidraw's own names). */
export const FONT_NAMES = [
  "Excalifont",
  "Nunito",
  "Lilita One",
  "Comic Shanns",
  "Virgil",
  "Helvetica",
  "Cascadia",
  "Liberation Sans",
] as const;

const ADD_TYPES = new Set([
  "image",
  "rectangle",
  "ellipse",
  "diamond",
  "text",
  "arrow",
  "line",
]);
/** What an arrow may bind to with `start`/`end`. */
const BINDABLE = new Set(["rectangle", "ellipse", "diamond", "text"]);

const startsWith = (b: Uint8Array, sig: readonly number[], at = 0) =>
  b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v);

/** Does the start of `bytes` look like `mime`? (A cheap check; the editor still decodes it.) */
export const looksLike = (mime: string, bytes: Uint8Array): boolean => {
  switch (mime) {
    case "image/png":
      return startsWith(
        bytes,
        [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      );
    case "image/jpeg":
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case "image/gif":
      return startsWith(bytes, [0x47, 0x49, 0x46, 0x38]);
    case "image/webp":
      return (
        startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
        startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
      );
    case "image/svg+xml": {
      const head = new TextDecoder().decode(bytes.subarray(0, 1024));
      return head.includes("<svg");
    }
    default:
      return false;
  }
};

/** A Uint8Array, also when it comes from another realm (a worker, a test window). */
export const isBytes = (v: unknown): v is Uint8Array =>
  Object.prototype.toString.call(v) === "[object Uint8Array]";

/** Why `image` (the `image` prop of an added image) is not acceptable, or null. */
export const imageProblem = (v: unknown): string | null => {
  if (
    !isRecord(v) ||
    Object.keys(v).some((k) => k !== "mime" && k !== "bytes")
  ) {
    return "must be { mime, bytes }";
  }
  if (
    typeof v.mime !== "string" ||
    !(IMAGE_MIMES as readonly string[]).includes(v.mime)
  ) {
    return `mime must be one of ${IMAGE_MIMES.join(", ")}`;
  }
  if (!isBytes(v.bytes) || v.bytes.length === 0) {
    return "bytes must be a non-empty Uint8Array";
  }
  if (v.bytes.length > MAX_IMAGE_BYTES) {
    return `bytes are larger than ${MAX_IMAGE_BYTES} (${
      MAX_IMAGE_BYTES / 1024 / 1024
    } MiB)`;
  }
  if (!looksLike(v.mime, v.bytes)) {
    return `bytes do not look like ${v.mime}`;
  }
  return null;
};

/** Bytes an image file adds to the drawing JSON: its data URL. */
export const imageDataUrlBytes = (mime: string, byteLength: number): number =>
  `data:${mime};base64,`.length + Math.ceil(byteLength / 3) * 4;

/** The part of the drawing size an image batch is measured against. */
export const imageBudget = (currentBytes: number): number =>
  DRAWING_BYTES_HEADROOM * MAX_DRAWING_BYTES - currentBytes;

/** The customData key of a plugin: the declared one, else `plugins.<id>`. */
export const dataKeyFor = (pluginId: string, declared?: string | null) =>
  declared ?? `plugins.${pluginId}`;

/**
 * null when plugin `pluginId` may declare `key` as its data key, else why
 * not. Keys under `plugins.` belong to the plugin of that id, so one plugin
 * cannot read or write another's data by declaring its default key.
 */
export const dataKeyProblem = (
  key: unknown,
  pluginId?: string,
): string | null => {
  if (
    typeof key !== "string" ||
    key.length > MAX_DATA_KEY ||
    !DATA_KEY.test(key)
  ) {
    return `must be 1 to ${MAX_DATA_KEY} lower case letters, digits, "_" or "-", in parts joined by "."`;
  }
  if (
    pluginId !== undefined &&
    (key === "plugins" || key.startsWith("plugins.")) &&
    key !== `plugins.${pluginId}`
  ) {
    return `keys under "plugins." belong to the plugin of that id; use "plugins.${pluginId}" or another key`;
  }
  return null;
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

type Check = (v: unknown) => string | null;

const num =
  (min: number, max: number): Check =>
  (v) =>
    typeof v === "number" && Number.isFinite(v) && v >= min && v <= max
      ? null
      : `must be a finite number in ${min}..${max}`;

const oneOf =
  (values: readonly string[]): Check =>
  (v) =>
    typeof v === "string" && values.includes(v)
      ? null
      : `must be one of ${values.map((x) => `"${x}"`).join(", ")}`;

const NAMED = new Set(
  "transparent aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen".split(
    " ",
  ),
);

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** CSS named colours (plus "transparent") and hex forms accepted for strokes and fills. */
export const isAllowedColor = (v: unknown): v is string =>
  typeof v === "string" && (HEX.test(v) || NAMED.has(v.toLowerCase()));

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

// Schemes that run code or embed content are refused; anything else is shown
// by Excalidraw's own link handling (which sanitises again).
const BAD_SCHEME = /^\s*(javascript|data|vbscript|file):/i;

const link: Check = (v) =>
  v === null ||
  (typeof v === "string" &&
    v.length <= MAX_LINK &&
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f]/.test(v) &&
    !BAD_SCHEME.test(v))
    ? null
    : `must be null or a link of at most ${MAX_LINK} characters (no javascript:, data:, vbscript: or file:)`;

const bool: Check = (v) =>
  typeof v === "boolean" ? null : "must be true or false";

const TURN = 2 * Math.PI;

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
  angle: num(-TURN, TURN),
  strokeStyle: oneOf(["solid", "dashed", "dotted"]),
  fillStyle: oneOf(["hachure", "cross-hatch", "solid", "zigzag"]),
  roundness: oneOf(["sharp", "round"]),
  fontFamily: oneOf(FONT_NAMES),
  link,
  locked: bool,
};

/** Props checked on their own (`data` needs the key; `start`/`end` need refs). */
const SPECIAL = new Set(["type", "data", "start", "end", "image"]);

/** The part of an element the op rules look at. */
export interface OpTarget {
  type: string;
  isDeleted?: boolean;
  containerId?: string | null;
}

export interface ValidateOptions {
  /** Most ops in one batch (default MAX_OPS, never above MAX_OPS_LIMIT). */
  maxOps?: number;
  /** The caller's customData key; without one, `data` is refused. */
  dataKey?: string | null;
  /**
   * Whether `image` adds are allowed. Only a caller that can store the picture
   * (the plugin `scene.batch`) says yes; `createDrawing` and the control API do not.
   */
  allowImages?: boolean;
}

/** The ops limit in force: `requested` clamped to 1..MAX_OPS_LIMIT. */
export const opsLimit = (requested?: number): number =>
  typeof requested === "number" && Number.isInteger(requested)
    ? Math.min(MAX_OPS_LIMIT, Math.max(1, requested))
    : MAX_OPS;

const checkProps = (
  props: Record<string, unknown>,
  op: number,
  issues: SceneOpIssue[],
) => {
  for (const key of Object.keys(props)) {
    const check = Object.prototype.hasOwnProperty.call(PROPS, key)
      ? PROPS[key]
      : null;
    if (!check) {
      if (SPECIAL.has(key)) {
        continue;
      }
      issues.push({ op, key, message: "unknown property" });
      continue;
    }
    const problem = check(props[key]);
    if (problem) {
      issues.push({ op, key, message: problem });
    }
  }
};

const checkData = (
  props: Record<string, unknown>,
  op: number,
  issues: SceneOpIssue[],
  dataKey: string | null | undefined,
) => {
  if (!("data" in props)) {
    return;
  }
  if (!dataKey) {
    issues.push({
      op,
      key: "data",
      message: "plugin data is not available here",
    });
    return;
  }
  const value = props.data;
  if (value === null) {
    return;
  }
  if (value === undefined || !isJsonValue(value)) {
    issues.push({
      op,
      key: "data",
      message:
        "must be JSON (no undefined, functions, class instances, NaN, Infinity or cycles) or null",
    });
    return;
  }
  if (utf8Length(JSON.stringify(value)) > MAX_DATA_BYTES) {
    issues.push({
      op,
      key: "data",
      message: `is larger than ${MAX_DATA_BYTES} bytes as JSON`,
    });
  }
};

export const validateOps = (
  ops: unknown,
  existing: ReadonlyMap<string, OpTarget>,
  options: ValidateOptions = {},
): SceneOp[] => {
  if (!Array.isArray(ops)) {
    throw new SceneOpsError([{ op: -1, message: "ops must be an array" }]);
  }
  const max = opsLimit(options.maxOps);
  if (ops.length > max) {
    throw new SceneOpsError([
      {
        op: -1,
        message: `at most ${max} ops per batch (plugins.scene_max_ops)`,
      },
    ]);
  }
  const issues: SceneOpIssue[] = [];

  // Refs first: start, end and group may name an add that comes later.
  const refs = new Map<string, string>(); // ref -> element type
  ops.forEach((raw: unknown, i) => {
    if (!isRecord(raw) || raw.op !== "add" || !("ref" in raw)) {
      return;
    }
    if (typeof raw.ref !== "string" || !REF.test(raw.ref)) {
      issues.push({
        op: i,
        key: "ref",
        message: 'must be 1 to 64 letters, digits, "_", "-", "." or ":"',
      });
    } else if (refs.has(raw.ref)) {
      issues.push({
        op: i,
        key: "ref",
        message: "ref already used in this batch",
      });
    } else {
      const el = raw.element;
      refs.set(
        raw.ref,
        isRecord(el) && typeof el.type === "string" ? el.type : "",
      );
    }
  });

  const deleted = new Set<string>();
  const liveTarget = (
    id: unknown,
    op: number,
    key: string,
  ): OpTarget | null => {
    const el = typeof id === "string" ? existing.get(id) : undefined;
    if (!el || el.isDeleted) {
      issues.push({ op, key, message: "no such element" });
      return null;
    }
    if (deleted.has(id as string)) {
      issues.push({
        op,
        key,
        message: "element was deleted earlier in this batch",
      });
      return null;
    }
    return el;
  };

  const checkEnd = (end: unknown, op: number, key: "start" | "end") => {
    if (!isRecord(end) || Object.keys(end).length !== 1) {
      issues.push({
        op,
        key,
        message: "must be { ref } naming an element added in this batch",
      });
      return;
    }
    if ("id" in end) {
      issues.push({
        op,
        key,
        message:
          "binding to an element already on the canvas is not supported yet; add it in this batch and use { ref }",
      });
      return;
    }
    const type = typeof end.ref === "string" ? refs.get(end.ref) : undefined;
    if (type === undefined) {
      issues.push({ op, key, message: "no add in this batch has this ref" });
    } else if (!BINDABLE.has(type)) {
      issues.push({
        op,
        key,
        message: "an arrow binds only to a rectangle, ellipse, diamond or text",
      });
    }
  };

  ops.forEach((raw: unknown, i) => {
    if (!isRecord(raw)) {
      issues.push({ op: i, message: "op must be an object" });
      return;
    }
    if (raw.op === "add") {
      for (const key of Object.keys(raw)) {
        if (key !== "op" && key !== "element" && key !== "ref") {
          issues.push({ op: i, key, message: "unknown property" });
        }
      }
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
      checkProps(el, i, issues);
      checkData(el, i, issues, options.dataKey);
      if (el.type === "image" && !options.allowImages) {
        issues.push({
          op: i,
          key: "type",
          message:
            "images are not available here; use scene.batch on the open drawing",
        });
      } else if (el.type === "image") {
        const problem = "image" in el ? imageProblem(el.image) : "is required";
        if (problem) {
          issues.push({ op: i, key: "image", message: problem });
        }
        for (const key of ["width", "height"]) {
          if (!(key in el)) {
            issues.push({
              op: i,
              key,
              message: "is required on an image (the size to show it at)",
            });
          }
        }
        for (const key of [
          "text",
          "fontSize",
          "fontFamily",
          "points",
          "roundness",
          "start",
          "end",
        ]) {
          if (key in el) {
            issues.push({
              op: i,
              key,
              message: "not valid on image elements",
            });
          }
        }
      } else if ("image" in el) {
        issues.push({
          op: i,
          key: "image",
          message: 'only valid when adding an element of type "image"',
        });
      }
      if (el.type === "text" && typeof el.text !== "string") {
        issues.push({ op: i, key: "text", message: "text elements need text" });
      }
      if (el.type === "text" && "roundness" in el) {
        issues.push({
          op: i,
          key: "roundness",
          message: "not valid on text elements",
        });
      }
      if (
        isRecord(el.start) &&
        isRecord(el.end) &&
        el.start.ref !== undefined &&
        el.start.ref === el.end.ref
      ) {
        issues.push({
          op: i,
          key: "end",
          message: "start and end must name different elements",
        });
      }
      for (const key of ["start", "end"] as const) {
        if (!(key in el)) {
          continue;
        }
        if (el.type !== "arrow") {
          issues.push({ op: i, key, message: "only valid on arrows" });
        } else {
          checkEnd(el[key], i, key);
        }
      }
    } else if (raw.op === "update") {
      const target = liveTarget(raw.id, i, "id");
      if (!isRecord(raw.props)) {
        issues.push({ op: i, key: "props", message: "must be an object" });
        return;
      }
      const props = raw.props;
      checkProps(props, i, issues);
      if ("data" in props) {
        checkData(props, i, issues, options.dataKey);
      }
      if ("image" in props) {
        issues.push({
          op: i,
          key: "image",
          message: "only valid when adding an image; add a new image instead",
        });
      }
      if ("start" in props || "end" in props) {
        for (const key of ["start", "end"]) {
          if (key in props) {
            issues.push({
              op: i,
              key,
              message: "only valid when adding an arrow",
            });
          }
        }
      }
      if (target && target.type !== "text") {
        if ("text" in props || "fontSize" in props || "fontFamily" in props) {
          for (const key of ["text", "fontSize", "fontFamily"]) {
            if (key in props) {
              issues.push({
                op: i,
                key,
                message: "only valid on text elements",
              });
            }
          }
        }
      } else if (target && "roundness" in props) {
        issues.push({
          op: i,
          key: "roundness",
          message: "not valid on text elements",
        });
      }
      if (
        target &&
        target.type !== "arrow" &&
        target.type !== "line" &&
        "points" in props
      ) {
        issues.push({
          op: i,
          key: "points",
          message: "only valid on lines and arrows",
        });
      }
    } else if (raw.op === "delete") {
      if (liveTarget(raw.id, i, "id")) {
        deleted.add(raw.id as string);
      }
    } else if (raw.op === "group") {
      const ids = raw.ids;
      if (!Array.isArray(ids) || ids.length < 2 || ids.length > max * 2) {
        issues.push({
          op: i,
          key: "ids",
          message: `must list 2 to ${max * 2} element ids or { ref } objects`,
        });
        return;
      }
      const seen = new Set<string>();
      ids.forEach((member: unknown) => {
        let key: string;
        if (typeof member === "string") {
          const el = liveTarget(member, i, "ids");
          if (el?.containerId) {
            issues.push({
              op: i,
              key: "ids",
              message:
                "a label is grouped with its container; list the container",
            });
          }
          key = `id:${member}`;
        } else if (
          isRecord(member) &&
          Object.keys(member).length === 1 &&
          typeof member.ref === "string"
        ) {
          if (!refs.has(member.ref)) {
            issues.push({
              op: i,
              key: "ids",
              message: `no add in this batch has ref "${member.ref}"`,
            });
          }
          key = `ref:${member.ref}`;
        } else {
          issues.push({
            op: i,
            key: "ids",
            message: "each member is an element id or { ref }",
          });
          return;
        }
        if (seen.has(key)) {
          issues.push({
            op: i,
            key: "ids",
            message: "an element is listed twice",
          });
        }
        seen.add(key);
      });
    } else {
      issues.push({
        op: i,
        key: "op",
        message: "must be add, update, delete or group",
      });
    }
  });
  if (issues.length) {
    throw new SceneOpsError(issues);
  }
  return ops as SceneOp[];
};
