/** Where a drawing's exports go, and which drawings are left out. Pure: no API calls. */
import type { Config } from "./config";

const DRAWING = /\.excalidraw$/i;

export const isDrawing = (path: string): boolean => DRAWING.test(path);

const stem = (path: string): string => path.replace(DRAWING, "");

/** The export path of `drawing` in one format: next to it, or in the mirrored folder. */
export const exportPath = (
  drawing: string,
  format: "svg" | "png",
  folder: string,
): string => `${folder === "" ? "" : `${folder}/`}${stem(drawing)}.${format}`;

/** Both formats, whatever is configured: renames and deletes clean up either. */
export const allExportPaths = (drawing: string, folder: string): string[] => [
  exportPath(drawing, "svg", folder),
  exportPath(drawing, "png", folder),
];

/** `folder` is the export folder: refused when a segment starts with a dot (Rust refuses it too). */
export const folderProblem = (folder: string): string | null =>
  folder.split("/").some((s) => s.startsWith("."))
    ? "The export folder cannot start with a dot"
    : null;

const under = (path: string, dir: string): boolean =>
  path === dir || path.startsWith(`${dir}/`);

/**
 * True when the drawing is left out by folder: it sits in a skipped folder, or inside the export
 * folder itself (its copies would mirror into themselves).
 */
export const isExcluded = (path: string, cfg: Config): boolean =>
  cfg.exclude.some((dir) => under(path, dir)) ||
  (cfg.folder !== "" && under(path, cfg.folder));

/** True when the drawing has a text with the skip tag (case does not matter). */
export const hasSkipTag = (
  elements: readonly { text?: string }[],
  tag: string,
): boolean => {
  if (tag === "") {
    return false;
  }
  const needle = tag.toLowerCase();
  return elements.some((e) => e.text?.toLowerCase().includes(needle));
};
