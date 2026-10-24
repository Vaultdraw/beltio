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
