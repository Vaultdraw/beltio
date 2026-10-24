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

/**
 * Keys inside the open theme browser. They apply only while it is open
 * (context key `themeBrowser.open`) and are rebindable like any command.
 * Escape closes every dialog and stays app-wide.
 */
export const THEME_BROWSER_CONTEXT_KEY = "themeBrowser.open";

export const THEME_BROWSER_COMMAND_IDS = {
  next: "themeBrowser.next",
  prev: "themeBrowser.prev",
  down: "themeBrowser.down",
  up: "themeBrowser.up",
  activate: "themeBrowser.activate",
  remove: "themeBrowser.remove",
  search: "themeBrowser.search",
  close: "themeBrowser.close",
} as const;

const I = THEME_COMMAND_IDS;
const B = THEME_BROWSER_COMMAND_IDS;
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

const inBrowser = (
  id: string,
  title: string,
  keys: string[],
): CommandDefinition => ({
  id,
  title,
  category: "Themes",
  keys: { default: keys },
  when: [THEME_BROWSER_CONTEXT_KEY],
});

export const THEME_BROWSER_COMMANDS: CommandDefinition[] = [
  inBrowser(B.next, "Theme browser: Next theme", ["ArrowRight"]),
  inBrowser(B.prev, "Theme browser: Previous theme", ["ArrowLeft"]),
  inBrowser(B.down, "Theme browser: Theme below", ["ArrowDown"]),
  inBrowser(B.up, "Theme browser: Theme above", ["ArrowUp"]),
  inBrowser(B.activate, "Theme browser: Install or use the selected theme", [
    "Enter",
  ]),
  inBrowser(B.remove, "Theme browser: Remove the selected theme", [
    "Delete",
    "Shift+Delete",
  ]),
  inBrowser(B.search, "Theme browser: Focus the search box", ["Slash"]),
  inBrowser(B.close, "Theme browser: Close", []),
];
