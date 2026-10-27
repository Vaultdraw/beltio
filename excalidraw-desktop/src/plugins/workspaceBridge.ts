import { hasDrawingExt } from "../vault/fileKind";
/**
 * What the plugin host may ask the vault shell (`ctx.vault.info`,
 * `ctx.workspace`). VaultApp sets it; the host reads it. No imports, so the
 * startup graph stays free of plugin host code.
 */
export interface WorkspaceBridge {
  /** The open vault (never its absolute path), or null. */
  vault(): { name: string; readOnly: boolean } | null;
  /** The active drawing's vault-relative path, or null. */
  activePath(): string | null;
  drawingExists(path: string): Promise<boolean>;
  /** Same core as the control method `file.open`; false when it failed. */
  openDrawing(path: string, newTab: boolean): Promise<boolean>;
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
