/** Binds the per-vault theme commands to the open vault's settings. */
import { useEffect, useRef } from "react";

import { registerCommandHandlers } from "../commands/handlerRegistry";

import {
  VAULT_THEME_COMMAND_IDS,
  VAULT_THEME_FIELDS,
} from "./vaultThemeCommands";

import type { UseVaultSettings } from "../vault/useVaultSettings";

export function useVaultThemeCommands(
  vaultSettings: UseVaultSettings,
  notify: (message: string) => void,
): void {
  const live = useRef({ vaultSettings, notify });
  live.current = { vaultSettings, notify };
  useEffect(
    () =>
      registerCommandHandlers({
        // Copies what is shown now, so nothing changes on screen.
        [VAULT_THEME_COMMAND_IDS.pin]: async () => {
          const { vaultSettings: v, notify: say } = live.current;
          for (const field of VAULT_THEME_FIELDS) {
            await v.setOverride(field, v.effective[field]);
          }
          say("This vault keeps its own theme");
        },
        [VAULT_THEME_COMMAND_IDS.reset]: async () => {
          const { vaultSettings: v, notify: say } = live.current;
          for (const field of VAULT_THEME_FIELDS) {
            await v.setOverride(field, null);
          }
          say("This vault uses the global theme");
        },
      }),
    [],
  );
}
