/**
 * What a vault file is, decided by its name alone: the one place for the extension rules
 * (twin of `vaultdraw-core/src/filekind.rs`; shared fixtures: `fixtures/filekind.json`).
 */

export const DRAWING_EXT = ".excalidraw";
export const NOTE_EXT = ".md";
export const EXCALIDRAW_MD_EXT = ".excalidraw.md";

/** drawing: `*.excalidraw`; note: `*.md`; excalidrawMd: Obsidian Excalidraw plugin `*.excalidraw.md`. */
export type FileKind = "drawing" | "note" | "excalidrawMd" | "other";

/** `ext` is lower case ASCII; compares without allocating (it runs per item on large lists). */
const endsWithCi = (name: string, ext: string): boolean => {
  const offset = name.length - ext.length;
  if (offset < 0) {
    return false;
  }
  for (let i = 0; i < ext.length; i++) {
    const c = name.charCodeAt(offset + i);
    // ASCII upper case to lower case; other code units compare as they are.
    if ((c >= 65 && c <= 90 ? c + 32 : c) !== ext.charCodeAt(i)) {
      return false;
    }
  }
  return true;
};

/** `name` (a file name or vault-relative path) ends with `.excalidraw`, in any case. */
export const hasDrawingExt = (name: string): boolean =>
  endsWithCi(name, DRAWING_EXT);

/** `name` without a trailing `.excalidraw` (any case); unchanged when it has none. */
export const stripDrawingExt = (name: string): string =>
  hasDrawingExt(name) ? name.slice(0, name.length - DRAWING_EXT.length) : name;

/**
 * A drawing's name without its extension, for an Obsidian drawing too: "Plan.excalidraw" and
 * "Plan.excalidraw.md" give "Plan" (toimprove 236). Notes and other files keep theirs.
 */
export const drawingStem = (name: string): string =>
  fileKind(name) === "excalidrawMd"
    ? name.slice(0, name.length - EXCALIDRAW_MD_EXT.length)
    : stripDrawingExt(name);

export const fileKind = (name: string): FileKind => {
  if (hasDrawingExt(name)) {
    return "drawing";
  }
  if (endsWithCi(name, EXCALIDRAW_MD_EXT)) {
    return "excalidrawMd";
  }
  if (endsWithCi(name, NOTE_EXT)) {
    return "note";
  }
  return "other";
};

/** A name starting with a dot (`.obsidian`, `.trash`, `.git`): never listed, scanned, indexed or watched. */
export const isHiddenName = (name: string): boolean => name.startsWith(".");

/** True when any component of a vault-relative path is hidden. */
export const hasHiddenComponent = (path: string): boolean =>
  path.split("/").some(isHiddenName);

/** The name a tree row, tab or title shows: no `.excalidraw`, `.excalidraw.md` or `.md`. */
export const entryDisplayName = (name: string): string => {
  const kind = fileKind(name);
  if (kind === "drawing") {
    return stripDrawingExt(name);
  }
  if (kind === "excalidrawMd") {
    return name.slice(0, name.length - EXCALIDRAW_MD_EXT.length);
  }
  if (kind === "note") {
    return name.slice(0, name.length - NOTE_EXT.length);
  }
  return name;
};

/** Drawings that Vaultdraw writes: only native `.excalidraw` files (Obsidian Excalidraw files are read-only here). */
export const isWritableDrawing = (path: string): boolean =>
  fileKind(path) === "drawing";

/** The extension a rename keeps for this name (none for folders and other files). */
export const entryExtension = (name: string): string => {
  const kind = fileKind(name);
  if (kind === "drawing") {
    return name.slice(name.length - DRAWING_EXT.length);
  }
  if (kind === "excalidrawMd") {
    return name.slice(name.length - EXCALIDRAW_MD_EXT.length);
  }
  if (kind === "note") {
    return name.slice(name.length - NOTE_EXT.length);
  }
  return "";
};

/** The word for an entry in dialogs: Drawing, Note or Folder. */
export const entryWord = (kind: string): "Drawing" | "Note" | "Folder" =>
  kind === "folder" ? "Folder" : kind === "note" ? "Note" : "Drawing";
