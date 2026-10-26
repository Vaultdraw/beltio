/**
 * Per-vault theme commands: keep this vault's look (theme, mode, accent) in
 * its settings.toml, or go back to the global one. Handlers are bound by
 * useVaultThemeCommands.ts.
 */
import type { CommandDefinition } from "../commands/types";

export const VAULT_THEME_COMMAND_IDS = {
  pin: "appearance.vaultTheme.pin",
  reset: "appearance.vaultTheme.reset",
} as const;

/** The appearance fields a vault may override. */
export const VAULT_THEME_FIELDS = [
  "colorTheme",
  "theme",
  "accentColor",
] as const;

export const VAULT_THEME_COMMANDS: readonly CommandDefinition[] = [
  {
    id: VAULT_THEME_COMMAND_IDS.pin,
    title: "Appearance: Use the current theme for this vault only",
    category: "Appearance",
    keys: { default: [] },
    when: ["vaultOpen", "writable", "!modalOpen"],
  },
  {
    id: VAULT_THEME_COMMAND_IDS.reset,
    title: "Appearance: Use the global theme in this vault",
    category: "Appearance",
    keys: { default: [] },
    when: ["vaultOpen", "writable", "!modalOpen"],
  },
];
