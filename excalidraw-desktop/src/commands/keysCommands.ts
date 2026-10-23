/**
 * Key-sequence commands. No default keys: they are for the palette and for
 * users who bind them. Handlers are bound by the which-key host.
 */
import type { CommandDefinition } from "./types";

export const KEYS_COMMAND_IDS = {
  whichKey: "keys.whichKey",
  cancel: "keys.cancel",
} as const;

export const KEYS_COMMANDS: readonly CommandDefinition[] = [
  {
    id: KEYS_COMMAND_IDS.whichKey,
    title: "Keys: show which-key",
    category: "Keys",
    keys: { default: [] },
    when: ["vaultOpen"],
  },
  {
    id: KEYS_COMMAND_IDS.cancel,
    title: "Keys: cancel pending sequence",
    category: "Keys",
    keys: { default: [] },
  },
];
