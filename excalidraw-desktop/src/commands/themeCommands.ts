/**
 * Theme install commands. The shell binds them (useThemeInstallCommands) to
 * the install dialog's store; the dialog itself is a lazy chunk.
 */
import type { CommandDefinition } from "./types";

export const THEME_COMMAND_IDS = {
  browse: "theme.browse",
  browseRefresh: "theme.browseRefresh",
  installFromUrl: "theme.installFromUrl",
  update: "theme.update",
  uninstall: "theme.uninstall",
} as const;

const I = THEME_COMMAND_IDS;
const VAULT = ["vaultOpen", "!modalOpen"] as const;

const command = (id: string, title: string): CommandDefinition => ({
  id,
  title,
  category: "Themes",
  keys: { default: [] },
  when: [...VAULT],
});

export const THEME_COMMANDS: CommandDefinition[] = [
  command(I.browse, "Themes: Browse community themes"),
  command(I.browseRefresh, "Themes: Refresh the community themes list"),
  command(I.installFromUrl, "Themes: Install from URL or GitHub repo"),
  command(I.update, "Themes: Check installed themes for updates"),
  command(I.uninstall, "Themes: Remove an installed theme"),
];
