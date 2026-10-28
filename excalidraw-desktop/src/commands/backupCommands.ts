/**
 * Backup commands: write a zip of the vault, restore one into a new folder. Both are
 * rebindable and have no default key. The work is native (src-tauri/src/backup.rs); the
 * handlers come from the app shell (VaultApp), which knows the open vault.
 */
import type { CommandDefinition } from "./types";

export const BACKUP_COMMAND_IDS = {
  backup: "vault.backup",
  restore: "vault.restoreBackup",
} as const;

export const BACKUP_COMMANDS: CommandDefinition[] = [
  {
    id: BACKUP_COMMAND_IDS.backup,
    title: "Vault: Back up vault…",
    category: "Vault",
    keys: { default: [] },
    when: ["vaultOpen"],
  },
  {
    id: BACKUP_COMMAND_IDS.restore,
    title: "Vault: Restore from backup…",
    category: "Vault",
    keys: { default: [] },
  },
];
