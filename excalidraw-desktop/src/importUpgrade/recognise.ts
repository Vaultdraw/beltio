/**
 * Which drawings a Markdown import made (toimprove #110). The import marks headings and callouts
 * (`customData["plugins.markdown-import"]`), so a note with neither (a poem, a list, an empty
 * note) carries no mark: 273 of the owner's 1,190 imports. Those are recognised by the shape the
 * import gives every drawing it writes, which the editor never produces by hand:
 *
 * - page mode on, written by Vaultdraw;
 * - every element made in the same millisecond (the import stamps one `created` per drawing; a
 *   hand-made drawing gets one per shape), with no deleted ones (nothing was removed since);
 * - only the kinds the import draws (text, boxes, lines, pictures);
 * - the leftmost element at a page margin (the import starts every line there).
 *
 * An empty page-mode drawing has no shape to judge: it counts when it sits in a folder an Obsidian
 * import wrote (one holding an "Import report" drawing, in it or above it).
 */
import { editState } from "./stamp";
import { IMPORT_MARK } from "./upgradeScene";

type El = Record<string, unknown>;
type Scene = {
  source?: unknown;
  elements?: El[];
  appState?: Record<string, unknown>;
};

/** The drawing the Obsidian import writes at the top of the folder it imports into. */
export const REPORT_NAME = "Import report.excalidraw";

const IMPORT_KINDS = new Set(["text", "rectangle", "line", "image"]);
/** The import's page margins lie in this range (scene pixels from the page's left edge). */
const MARGIN = { min: 16, max: 128 };

export type Recognised =
  /** The import's mark is on a heading or callout. */
  | "marked"
  /** No mark, but every element has the shape the import writes. */
  | "shape"
  /** Empty, in a folder an Obsidian import wrote. */
  | "emptyInImport";

const marked = (e: El) =>
  typeof e.customData === "object" &&
  e.customData !== null &&
  IMPORT_MARK in (e.customData as object);

const pageMode = (scene: Scene) =>
  (scene.appState?.pageSetup as { enabled?: unknown } | undefined)?.enabled ===
  true;

/**
 * True when a drawing is still exactly as the import (or the app's own update) wrote it: see
 * `stamp.ts`. A drawing imported before stamps existed is not untouched: nobody can tell.
 */
export const untouchedSince = (scene: Scene): boolean =>
  editState(scene) === "untouched";

/** True when the elements look like one untouched run of the import. */
const importShape = (els: readonly El[]): boolean => {
  if (els.length === 0 || els.some((e) => e.isDeleted === true)) {
    return false;
  }
  const created = els[0].created;
  if (typeof created !== "number") {
    return false;
  }
  let left = Infinity;
  for (const e of els) {
    if (e.created !== created || !IMPORT_KINDS.has(e.type as string)) {
      return false;
    }
    if (typeof e.x === "number") {
      left = Math.min(left, e.x);
    }
  }
  return left >= MARGIN.min && left <= MARGIN.max;
};

/** How the drawing is known to be an import, or null when it is not one (or was changed since). */
export function recognise(
  scene: Scene,
  inImportFolder = false,
): Recognised | null {
  const els = Array.isArray(scene.elements) ? scene.elements : [];
  if (els.some(marked)) {
    return "marked";
  }
  if (
    !pageMode(scene) ||
    (scene.source ?? "").toString().includes("obsidian")
  ) {
    return null;
  }
  if (els.length === 0) {
    return inImportFolder ? "emptyInImport" : null;
  }
  return importShape(els) ? "shape" : null;
}

/** The folders (vault-relative, "" for the root) that hold an import report drawing. */
export const importFolders = (paths: readonly string[]): Set<string> =>
  new Set(
    paths
      .filter((p) => p === REPORT_NAME || p.endsWith(`/${REPORT_NAME}`))
      .map((p) => p.slice(0, Math.max(0, p.length - REPORT_NAME.length - 1))),
  );

/** True when `path` lies in one of `folders` (or below it). */
export const inFolders = (path: string, folders: ReadonlySet<string>) => {
  for (const f of folders) {
    if (f === "" || path.startsWith(`${f}/`)) {
      return true;
    }
  }
  return false;
};
