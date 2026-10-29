import { hasDrawingExt } from "../vault/fileKind";

import type { ImportDrawingLook } from "../vault/newDrawingPaper";

import type {
  ReplaceOptions,
  ReplaceResult,
  TrashResult,
} from "../vault/replaceDrawing";
/**
 * What the plugin host may ask the vault shell (`ctx.vault.info`,
 * `ctx.workspace`, `ctx.pages.createDocument`, `ctx.scene.scrollTo`,
 * `ctx.folders`). VaultApp sets it; the host reads it. No imports, so the
 * startup graph stays free of plugin host code.
 */
export interface WorkspaceBridge {
  /** The open vault (never its absolute path), or null. */
  vault(): { name: string; readOnly: boolean } | null;
  /** The active drawing's vault-relative path, or null. */
  activePath(): string | null;
  /** The key label bound to opening `path`, or null. */
  openShortcut(path: string): string | null;
  drawingExists(path: string): Promise<boolean>;
  /** Same core as the control method `file.open`; false when it failed. */
  openDrawing(path: string, newTab: boolean): Promise<boolean>;
  /**
   * The folder a new drawing goes to (the `files.new_drawing_folder`
   * setting, created when missing, else next to the open drawing). null when
   * no vault is open or the folder could not be created (the app showed why).
   */
  newDrawingParent(): Promise<string | null>;
  /** The paper and tool defaults an imported drawing starts with (what a new drawing gets). */
  importLook?(): ImportDrawingLook;
  /** The appState a blank new drawing starts with (paper, page setup, tool defaults). */
  newDrawingState?(): Record<string, unknown>;
  /** Writes a new drawing from scene JSON and opens it, as the UI's "New drawing" does. */
  createDrawing(parent: string, name: string, json: string): Promise<void>;
  /** Writes a new drawing from scene JSON without opening it; resolves to its revision. */
  writeDrawing(path: string, json: string): Promise<string>;
  /**
   * Writes scene JSON over a drawing after saving it as it was in History (creates it when it does
   * not exist). See vault/replaceDrawing.ts.
   */
  replaceDrawing?(
    path: string,
    json: string,
    opts: ReplaceOptions,
  ): Promise<ReplaceResult>;
  /** Saves a drawing in History, then moves it to the Trash. See vault/replaceDrawing.ts. */
  trashDrawing?(path: string, opts: ReplaceOptions): Promise<TrashResult>;
  /**
   * Saves pending edits when `path` is the open drawing and resolves to the
   * revision on disk after; null when the drawing is not open.
   */
  flushDrawing(path: string): Promise<string | null>;
  /** The revision of a drawing on disk, null when it does not exist. */
  drawingRevision(path: string): Promise<string | null>;
  /** Selects an element of the open drawing and scrolls it into view (the search-result path). */
  focusElement(path: string, elementId: string): void;
  /** Opens the folder behind an import target handle as the vault (`import_target_root`). */
  openVaultFolder(handle: string): Promise<void>;
  /** Expands the file tree down to `path` (a vault-relative folder). */
  revealFolder(path: string): Promise<void>;
}

let bridge: WorkspaceBridge | null = null;

export function setWorkspaceBridge(next: WorkspaceBridge | null): void {
  bridge = next;
}

export const getWorkspaceBridge = (): WorkspaceBridge | null => bridge;

/**
 * A changed path plugins may hear about (`vault.changed`): no segment starts
 * with a dot, and the last one is a drawing or has no extension (a folder).
 */
export const isPluginVisiblePath = (path: string): boolean => {
  const segs = path.split("/");
  if (segs.some((s) => s.startsWith("."))) {
    return false;
  }
  const last = segs[segs.length - 1];
  return !last.includes(".") || hasDrawingExt(last);
};
