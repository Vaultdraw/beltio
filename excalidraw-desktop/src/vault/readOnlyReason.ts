import { fileManagerWord } from "../platform/platformWords";

import type { VaultInfo } from "./types";

/** Plain-language explanation of why a vault is read-only (toimprove #40). */
export function describeReadOnly(
  vault: Pick<VaultInfo, "readOnlyReason" | "lockHolderPid">,
): { summary: string; detail: string } {
  switch (vault.readOnlyReason) {
    case "notWritable":
      return {
        summary: "Folder is not writable",
        detail: `You don't have permission to change files in this folder. Fix the folder's permissions in ${fileManagerWord()}, then try again.`,
      };
    case "lockedByOtherProcess":
      return {
        summary: "Open in another Vaultdraw",
        detail: `Another Vaultdraw${
          vault.lockHolderPid ? ` (process ${vault.lockHolderPid})` : ""
        } has this vault open. Quit it, then try again.`,
      };
    case "lockUnavailable":
      return {
        summary: "Vault lock file unusable",
        detail:
          "The vault's lock file (.excalidraw-vault.lock) is not a normal file. Remove or fix it, then try again.",
      };
    default:
      return {
        summary: "Opened read-only",
        detail:
          "Vaultdraw could not get write access to this vault. Try again, or reopen the vault.",
      };
  }
}
