import type { VaultInfo } from "../vault/types";

/**
 * Opens a vault folder by absolute path through the native `open_vault_at`
 * command (same as choose_vault minus the dialog) and returns its handle info.
 */
export async function openVaultAtPath(path: string): Promise<VaultInfo> {
  const { invoke } = await import("@tauri-apps/api/core");
  return (await invoke("open_vault_at", { path })) as VaultInfo;
}
