/** Binds the per-vault theme commands to the open vault's settings. */
import { useEffect, useRef } from "react";

import { registerCommandHandlers } from "../commands/handlerRegistry";

import {
  VAULT_THEME_COMMAND_IDS,
  VAULT_THEME_FIELDS,
} from "./vaultThemeCommands";

import type { UseVaultSettings } from "../vault/useVaultSettings";
import type { VaultOverrideChanges } from "../vault/vaultSettings";

export function useVaultThemeCommands(
  vaultSettings: UseVaultSettings,
  notify: (message: string) => void,
): void {
  const live = useRef({ vaultSettings, notify });
  live.current = { vaultSettings, notify };
  useEffect(
    () =>
      registerCommandHandlers({
        // Copies what is shown now, so nothing changes on screen. One write:
        // all three fields or none.
        [VAULT_THEME_COMMAND_IDS.pin]: async () => {
          const { vaultSettings: v, notify: say } = live.current;
          const changes: VaultOverrideChanges = {};
          for (const field of VAULT_THEME_FIELDS) {
            Object.assign(changes, { [field]: v.effective[field] });
          }
          say(
            (await v.setOverrides(changes))
              ? "This vault keeps its own theme"
              : "Could not save this vault's theme",
          );
        },
        [VAULT_THEME_COMMAND_IDS.reset]: async () => {
          const { vaultSettings: v, notify: say } = live.current;
          const changes: VaultOverrideChanges = {};
          for (const field of VAULT_THEME_FIELDS) {
            if (v.isOverridden(field)) {
              Object.assign(changes, { [field]: null });
            }
          }
          if (Object.keys(changes).length === 0) {
            say("This vault already uses the global theme");
            return;
          }
          say(
            (await v.setOverrides(changes))
              ? "This vault uses the global theme"
              : "Could not change this vault's theme",
          );
        },
      }),
    [],
  );
}
