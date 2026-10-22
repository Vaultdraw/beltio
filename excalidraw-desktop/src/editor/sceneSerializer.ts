import { serializeAsJSON } from "@excalidraw/excalidraw";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import type {
  AppState,
  BinaryFileData,
  BinaryFiles,
} from "@excalidraw/excalidraw/types";

import { appendDrawingStyles } from "../toolDefaults/drawingStyles";
import { toAsciiJson } from "../vault/asciiJson";

import type { DrawingStyles } from "../toolDefaults/drawingStyles";

/**
 * Scene serializer for autosave and "Save a copy".
 *
 * `serializeAsJSON` re-stringifies every image dataURL on every call (tens of
 * MB for image-heavy drawings). Here the scene is serialized with an empty
 * `files` map and the files block is spliced in from a per-file cache of
 * already indented JSON, so the output stays byte-identical.
 */

// What `serializeAsJSON(..., {}, "local")` always ends with: `files` is the
// last key. A string value cannot contain a raw newline, so this suffix cannot
// be forged by user text.
const EMPTY_FILES_SUFFIX = `,\n  "files": {}\n}`;

type CachedFragment = {
  /** Shallow copy of the file at stringify time; dataURL compared by reference. */
  snapshot: Record<string, unknown>;
  /** Indented text before and after the dataURL value, quotes excluded. Small. */
  before: string;
  after: string;
  /** dataURL is ASCII and needs no JSON escaping: spliced in raw (no copy). */
  safe: boolean;
};

const fragments = new WeakMap<BinaryFileData, CachedFragment>();

// A dataURL spliced in raw must be what JSON.stringify + toAsciiJson would
// write: no `"`, `\` or C0 controls (JSON escapes) and nothing non-ASCII
// (\uXXXX escapes). Anything else takes the slow path (rare: base64 is ASCII).
// eslint-disable-next-line no-control-regex
const ASCII_NEEDS_NO_ESCAPING = /^[^"\\\u0000-\u001f\u0080-\uffff]*$/;
const MARKER = `vaultdraw-dataurl-${Math.random().toString(36).slice(2)}`;
const QUOTED_MARKER = `"${MARKER}"`;

const isUnchanged = (
  file: BinaryFileData,
  snapshot: Record<string, unknown>,
): boolean => {
  const current = file as unknown as Record<string, unknown>;
  const keys = Object.keys(current);
  if (keys.length !== Object.keys(snapshot).length) {
    return false;
  }
  for (const key of keys) {
    // Excalidraw bumps `version` and `lastRetrieved` in place.
    if (!(key in snapshot) || snapshot[key] !== current[key]) {
      return false;
    }
  }
  return true;
};

const indent = (text: string) => text.replace(/\n/g, "\n    ");

const buildFragment = (file: BinaryFileData): CachedFragment | null => {
  if (typeof file.dataURL !== "string") {
    return null;
  }
  // Same key order as `file`, with the big value swapped for a short marker.
  const text = JSON.stringify({ ...file, dataURL: MARKER }, null, 2);
  const at = text.indexOf(QUOTED_MARKER);
  if (at < 0 || text.indexOf(QUOTED_MARKER, at + 1) >= 0) {
    return null;
  }
  return {
    snapshot: { ...file },
    before: toAsciiJson(indent(text.slice(0, at))),
    after: toAsciiJson(indent(text.slice(at + QUOTED_MARKER.length))),
    safe: ASCII_NEEDS_NO_ESCAPING.test(file.dataURL),
  };
};

/** Test hook: the cached entry for a file, if any. */
export const peekFileFragment = (file: BinaryFileData) => fragments.get(file);

const fileBody = (file: BinaryFileData): string => {
  let cached = fragments.get(file);
  if (!cached || !isUnchanged(file, cached.snapshot)) {
    const built = buildFragment(file);
    if (!built) {
      fragments.delete(file);
      return toAsciiJson(indent(JSON.stringify(file, null, 2)));
    }
    cached = built;
    fragments.set(file, cached);
  }
  // Concatenation keeps a rope that points at the original dataURL string.
  const value = cached.safe
    ? `"${file.dataURL}"`
    : toAsciiJson(JSON.stringify(file.dataURL));
  return cached.before + value + cached.after;
};

/** Same selection and key order as the editor's own files filter. */
const referencedFiles = (
  elements: readonly ExcalidrawElement[],
  files: BinaryFiles,
): BinaryFiles => {
  const next: BinaryFiles = {};
  for (const element of elements) {
    if (
      !element.isDeleted &&
      "fileId" in element &&
      element.fileId &&
      files[element.fileId]
    ) {
      next[element.fileId] = files[element.fileId];
    }
  }
  return next;
};

/**
 * The same JSON value as `serializeAsJSON(elements, appState, files, "local")`
 * in pure-ASCII form (`toAsciiJson`: byte-identical when the scene is ASCII),
 * plus the drawing's style overrides as a trailing `vaultdraw` block when
 * there are any.
 */
export const serializeSceneForSave = (
  elements: readonly ExcalidrawElement[],
  appState: Partial<AppState>,
  files: BinaryFiles,
  styles?: DrawingStyles,
): string =>
  styles
    ? appendDrawingStyles(serializeScene(elements, appState, files), styles)
    : serializeScene(elements, appState, files);

const serializeScene = (
  elements: readonly ExcalidrawElement[],
  appState: Partial<AppState>,
  files: BinaryFiles,
): string => {
  const shell = toAsciiJson(serializeAsJSON(elements, appState, {}, "local"));
  const used = referencedFiles(elements, files);
  const ids = Object.keys(used);
  if (!ids.length) {
    return shell;
  }
  if (!shell.endsWith(EMPTY_FILES_SUFFIX)) {
    // The editor's format changed under us: never guess, use its serializer.
    return toAsciiJson(serializeAsJSON(elements, appState, files, "local"));
  }
  const entries = ids.map(
    (id) => `    ${toAsciiJson(JSON.stringify(id))}: ${fileBody(used[id])}`,
  );
  return `${shell.slice(
    0,
    -EMPTY_FILES_SUFFIX.length,
  )},\n  "files": {\n${entries.join(",\n")}\n  }\n}`;
};
